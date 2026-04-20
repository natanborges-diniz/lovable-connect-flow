

## Reconectar demandas/retornos/bots via Messenger (canal único)

### O que está quebrado hoje

| Capacidade | Estado | Problema |
|---|---|---|
| Operador → Loja: abrir demanda | ✅ funciona | Já cria `notificacoes` + `mensagens_internas` para usuários da loja |
| Loja → Operador: responder | ❌ quebrado | Resposta cai em `mensagens_internas` direto, mas **não vira `demanda_mensagens`** nem aparece no `DemandaLojaPanel`; `bot-lojas` está desligado |
| Encerramento de demanda | ⚠️ parcial | Notifica destinatários, mas não há "encerrar pela loja" pelo Messenger |
| Bots corporativos (Financeiro / TI / Departamentos: link pgto, boleto, CPF, reembolso) | ❌ quebrado | `bot-lojas` retorna `ignored` na linha 14; lojas não conseguem mais abrir solicitação alguma |
| Notificações de fluxos (`fluxo_responsaveis`) | ❌ quebrado | Disparavam via WhatsApp; sem código equivalente no Messenger |

### Arquitetura proposta — "Demandas-via-Messenger"

Reaproveita o pattern já implementado em `bridge-mensageria` (conversa-ponte por contato) e cria **conversas-demanda** no Messenger:

```text
                       infoco-ops (este projeto)
┌──────────────────────────────────────────────────────────────────┐
│  Operador abre demanda → criar-demanda-loja                       │
│    ├── insert demandas_loja                                        │
│    ├── insert mensagens_internas (conversa_id = demanda_<id>)     │
│    └── insert notificacoes → push                                  │
└──────────────────────────────────────────────────────────────────┘
                              ↕  (Realtime + Push)
┌──────────────────────────────────────────────────────────────────┐
│              Desktop Companion (app loja/colaborador)              │
│  Vê "Demandas" + responde no chat da conversa demanda_<id>         │
└──────────────────────────────────────────────────────────────────┘
                              ↕
       Trigger novo: on_mensagem_interna_demanda (conversa_id LIKE 'demanda_%')
                              ↓
            EF nova: bridge-demanda  →  insert demanda_mensagens
                                        update demandas_loja (resp/encerrada)
                                        notifica solicitante (push + UI)
```

**Convenção de conversa**: `conversa_id = 'demanda_' || demanda.id`. O `DemandaLojaPanel` continua lendo `demanda_mensagens` (sem mudança de UI), e a fonte de verdade da conversa entre operador↔loja passa a ser `mensagens_internas` espelhada para `demanda_mensagens` via trigger/EF.

### Mudanças

#### 1. Banco (migration)
- `mensagens_internas`: índice em `conversa_id` (já implícito, garantir).
- Trigger novo `on_mensagem_interna_demanda` em `mensagens_internas`: quando `conversa_id LIKE 'demanda_%'`, chama `bridge-demanda`.
- Sequência/coluna `protocolo` corporativo já existe (`SOL-AAAA-NNNNN`).

#### 2. Edge functions (novas / refeitas)

**`bridge-demanda`** (nova) — espelha mensagens internas ↔ thread da demanda:
- INPUT do trigger: `mensagem_interna_id`, `conversa_id`, `remetente_id`, `conteudo`.
- Extrai `demanda_id` do `conversa_id`.
- Resolve direção: se remetente é solicitante → `operador_para_loja`; senão → `loja_para_operador`.
- INSERT em `demanda_mensagens` (com flag anti-loop `metadata.via_bridge=true`).
- Atualiza `demandas_loja.ultima_mensagem_loja_at` + `vista_pelo_operador=false` quando vier da loja.
- Comandos textuais especiais da loja: `/encerrar` ou `/resolvido` → chama `encerrar-demanda-loja` com `encerrado_por='loja'`.
- Notifica solicitante via `notificacoes` quando resposta for da loja.

**`criar-demanda-loja`** (ajuste pequeno):
- Trocar `conversa_id = makeConversaId(operador, loja_user)` por **`conversa_id = 'demanda_' || demanda.id`** em **um grupo** (broadcast): cria N inserts com mesmo `conversa_id` mas `destinatario_id` distinto para cada usuário da loja → todos veem a mesma thread.
- Mensagem inicial inclui cabeçalho com protocolo + nome do cliente + dica "responda aqui ou /encerrar".

**`bot-lojas-messenger`** (nova, substitui `bot-lojas` para fluxos corporativos):
- Acionada quando uma mensagem interna chega em conversa que NÃO é demanda, NÃO é ponte, e o remetente é um colaborador/loja com `tipo_bot` configurado.
- Reusa `bot_fluxos` + `bot_menu_opcoes` (mesma engine do `bot-lojas` antigo).
- IO: lê do `mensagens_internas`, escreve resposta em `mensagens_internas` (do "Sistema · Bot Atrium" → usuário).
- Cria `solicitacoes` + `solicitacao_anexos` igual antes, mas anexos vêm de `mensagens_internas.anexo_url` (bucket `mensagens-anexos`).
- Mantém integração `payment-links` (OB), `consulta_cpf`, etc. Sem mudanças em `payment-webhook`.

**`notificarResponsaveis`** (refator dentro de `bot-lojas-messenger`):
- Em vez de WhatsApp, lê `fluxo_responsaveis` e busca o `user_id` correspondente em `telefones_lojas → setor_destino_id → user_roles`. Para cada um: `notificacoes` + `mensagens_internas` direto (1:1).

#### 3. Frontend (este projeto, painel operador)

**`DemandaLojaPanel.tsx`**:
- Adicionar badge "via Messenger" no cabeçalho.
- Já consome `demanda_mensagens` via Realtime → funciona automaticamente após bridge.
- `NovaDemandaDialog`: mostrar contagem de destinatários (`resolver_destinatarios_loja`) antes de enviar; alerta se `0`.
- `DemandaThreadDialog`: rótulos atuais (`loja_para_operador`, etc.) ficam corretos via bridge.

**`AppLayout` / Notificações**: nada a mudar — `useNotificacoes` já lê `notificacoes`.

#### 4. Memória
- Atualizar `mem://arquitetura/canal-unico-meta-e-app-atrium`: documentar `conversa_id = 'demanda_<id>'` e `bot-lojas-messenger`.
- Marcar `mem://bot-lojas/motor-de-fluxos-configuraveis` como "engine reutilizada via Messenger".
- Nova memória `mem://arquitetura/ponte-demandas-messenger` com a convenção do `conversa_id` e o trigger.

### Detalhes técnicos

- **Anti-loop**: `bridge-demanda` ignora qualquer `mensagens_internas` com `metadata.via_bridge=true`. `criar-demanda-loja` marca seus inserts iniciais com `metadata.bootstrap_demanda=true` para não duplicar em `demanda_mensagens` (ela já insere lá diretamente).
- **Multi-destinatário**: `mensagens_internas` é 1:1; usamos `conversa_id` compartilhado + N linhas (uma por destinatário) para broadcast. O bridge deduplica por `mensagens_internas.id` original (usar a primeira linha do batch como canônica via `metadata.broadcast_root_id`).
- **Anexos da loja**: `mensagens_internas.anexo_url` (bucket `mensagens-anexos` recém-criado) → bridge copia para `demanda_mensagens.anexo_url`.
- **`bot-lojas-messenger` — gatilho**: trigger em `mensagens_internas` que dispara quando `destinatario_id` = perfil "Sistema · Bot Atrium" (criado on-demand igual ao "Sistema · Ponte"). UI do Companion vai oferecer botão "Abrir bot" que envia mensagem para esse perfil.
- **Encerramento pela loja**: comando `/encerrar` no chat da demanda → `bridge-demanda` chama `encerrar-demanda-loja` com `X-Internal-Caller` + `encerrado_por='loja'` (já suportado).
- **`bot-lojas` antigo**: mantido como `410 Gone` para webhooks Meta legados; código real esvaziado.

### Plano de execução (tarefas)

1. Migration: trigger `on_mensagem_interna_demanda` + perfil "Sistema · Bot Atrium" placeholder.
2. EF nova `bridge-demanda` (espelha + comandos + notif solicitante).
3. Refator `criar-demanda-loja`: `conversa_id = 'demanda_<id>'`, broadcast por usuário, marca bootstrap.
4. EF nova `bot-lojas-messenger` (porta da engine `bot-lojas` para Messenger; mantém `bot_fluxos` e integração OB).
5. Trigger `on_mensagem_interna_bot` para acionar `bot-lojas-messenger`.
6. Ajustes UI em `DemandaLojaPanel` (badge + alerta destinatários=0).
7. Atualizar 3 memórias.
8. Teste E2E manual: abrir demanda → responder no Companion → ver no painel; comando `/encerrar`; fluxo "link de pagamento" pelo Companion.

