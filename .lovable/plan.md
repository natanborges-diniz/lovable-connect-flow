## Princípio: três fluxos distintos no mesmo backend, dois apps separados

```text
ATRIUM (Lovable Connect & Flow)               INFOCO MESSENGER
- Operadores CRM, setores, admin              - Lojas e colaboradores
- Pipelines, atendimento WhatsApp do cliente  - SEM acesso ao Atrium
- Abre Fluxo B (chat com loja/grupo)          - Recebe Fluxo A (cards) + Fluxo B (chat)
                  \                          /
                   \-- Supabase compartilhado --/
                    (mesma RLS, mesmas tabelas)
```

Lojas operam **exclusivamente** pelo InFoco Messenger. Atrium é para operadores/setores/admin.

---

## Os 3 fluxos

| # | Quem inicia | Onde inicia | Para quem | Como aparece pro destinatário | Comunicação |
|---|---|---|---|---|---|
| **A** | Loja | InFoco → "Nova Demanda" (menu corporativo) | Setor (Financeiro/TI/etc) | Card no pipeline do setor (Atrium) | Comentários no card + movimentação de coluna |
| **B1** | Setor (operador CRM/Gael) | Atrium → card de atendimento → "Acionar loja" | **1 loja específica** | Item em "Demandas" no InFoco da loja | Chat tipado bilateral (loja ↔ operador) |
| **B2** | Setor (operador CRM/Gael) | Atrium → card de atendimento → "Acionar grupo" | **Todas as lojas (grupo)** | Item em "Demandas" no InFoco de cada loja | Chat em **grupo estilo WhatsApp**: todas as lojas + operador veem tudo |

Operador encaminha respostas relevantes da loja → cliente final (WhatsApp Meta) com 1 clique.

---

## Parte 1 — Fluxo A: Loja → Setor (menu → card no pipeline)

### 1.1 InFoco Messenger: página "Nova Demanda" (já existe wizard, validar/ajustar)
- Menu hierárquico lendo `bot_menu_opcoes` (`tipo_bot='loja'`).
- Wizard por etapas conforme `bot_fluxos.etapas[]`.
- Visível só para `tipo_usuario IN ('loja','colaborador')`.

### 1.2 EF nova `criar-solicitacao-loja` (porta da lógica dormente em `bot-lojas` 281-365)
- Input: `{ fluxo_chave, dados, anexos[] }` + JWT da loja.
- Resolve `setor_destino_id` + `acao_final` via `bot_fluxos`.
- INSERT em `solicitacoes` com `pipeline_coluna_id` = primeira coluna do setor destino, `protocolo` via `nextval_protocolo()`, anexos em `comprovantes/{ano}/{protocolo}/`.
- **Caso especial `tipo=link_pagamento`**: chama OB `/payment-links` (INTERNAL_SERVICE_SECRET), salva `payment_link_id`, devolve URL pra loja, envia ao cliente via Meta, espera webhook `payment-webhook` (já pronto) que entrega o picote.
- Cria `notificacoes` para todos os usuários do setor destino (push + sino via triggers existentes).
- **NÃO cria `demandas_loja` nem `mensagens_internas` 'demanda_*'** — Fluxo A é card, não chat.

### 1.3 InFoco: página "Minhas Demandas" (read-only)
- Lista cards da loja (`solicitacoes` filtradas por `metadata->>'loja_nome'`).
- Mostra status atual da coluna no pipeline; permite anexar comprovante e comentar via `solicitacao_comentarios`.

---

## Parte 2 — Fluxo B: Setor → Loja(s) — chat tipado, com modo grupo

### 2.1 Atrium: botão "Acionar loja" no card de atendimento do cliente
- Em `AtendimentoDetail` (painel lateral), botão abre `AcionarLojaDialog`.
- Dois modos:
  - **Loja específica** → combo de `telefones_lojas WHERE tipo='loja' AND ativo`.
  - **Grupo (todas as lojas)** → todas as lojas ativas viram destinatárias.
- Campos: Assunto, Pergunta, anexo opcional.
- Submit → EF `criar-demanda-acionamento`.

### 2.2 EF nova `criar-demanda-acionamento`
- Cria 1 registro em `demandas_loja`:
  - `origem='operador'`, `solicitante_id` = operador, `setor_destino_id` = setor da loja.
  - `contato_cliente_id` + `atendimento_cliente_id` (preserva vínculo p/ encaminhamento ao cliente).
  - **Modo loja única**: `loja_nome` + `loja_telefone` da loja escolhida.
  - **Modo grupo**: `loja_nome='__GRUPO__'`, `loja_telefone='__GRUPO__'`, `metadata.grupo=true`, `metadata.lojas_ids=[snapshot das lojas ativas]`, `metadata.lojas_nomes=[...]`.
- Cria `notificacoes` para cada loja destinatária (push automático via trigger `trg_push_nova_notificacao`).
- Insere mensagem inicial em `demanda_mensagens` (`direcao='operador_to_loja'`, conteúdo = pergunta).

### 2.3 Conversa em grupo (estilo WhatsApp)
- A "sala" da demanda é o próprio `demanda_id`. Não precisa criar tabela nova.
- **Toda mensagem em `demanda_mensagens` é visível a todos os participantes daquela demanda** (operador + todas as lojas listadas em `metadata.lojas_ids`).
- Cada bolha guarda `autor_id` + `autor_nome` (nome da loja ou do operador) + `direcao` (`operador_to_loja` | `loja_to_operador`).
- Ao enviar, qualquer loja participante grava 1 linha em `demanda_mensagens` com seu `autor_nome` — todos os outros participantes recebem em realtime (Supabase channel por `demanda_id`).
- RLS: como `demanda_mensagens` já tem policy permissiva `authenticated can manage`, basta o cliente filtrar por `demanda_id`. Adicionar policy mais fina depois se necessário.

### 2.4 Atrium: `DemandaThreadPanel` (UI da thread no operador)
- Header: `Demanda #protocolo • Loja X` ou `Demanda #protocolo • Grupo (N lojas)` com lista expansível das lojas participantes.
- Cada bolha de loja mostra `autor_nome` em destaque (igual remetente em grupo WhatsApp).
- Ação por bolha: **"↗ Encaminhar ao cliente"** → chama EF `encaminhar-resposta-cliente`.
- Botão no header: **"Marcar como resolvida"** (status='resolvida', `encerrada_at=now()`).
- Comando `/encerrar` mantido como atalho.

### 2.5 InFoco Messenger: ajustes
- `DemandasList.tsx`: filtrar por loja logada — `loja_nome ILIKE :loja_nome OR (metadata->>'grupo'='true' AND metadata->'lojas_ids' ? :loja_id)`. Badge "Grupo" quando coletiva.
- Nova `DemandaChat.tsx`: thread completa, grava resposta em `demanda_mensagens` (`autor_nome=loja_nome`), suporta texto + anexo (bucket `mensagens-anexos`).
- Em demanda-grupo, cada loja vê **todas** as outras respostas (chat de grupo real).
- Botão "Marcar resolvida (minha loja)" só esconde localmente; fechamento global é do operador/admin.

### 2.6 Push para lojas em demanda nova
- Adicionar trigger `trg_push_demanda_loja_nova` em `demandas_loja AFTER INSERT`: chama `fn_send_push` para todos os user_ids das lojas destinatárias (1 loja ou snapshot de grupo).

---

## Parte 3 — Encaminhar resposta ao cliente final

### EF nova `encaminhar-resposta-cliente`
- Input: `demanda_mensagem_id`.
- Lê `demanda_mensagens` → `demandas_loja.atendimento_cliente_id` → `atendimentos.contato_id` → `contatos.telefone`.
- Envia via Meta WhatsApp:
  - Texto livre se janela 24h aberta.
  - Senão, template aprovado (`whatsapp_templates`).
- Marca `demanda_mensagens.encaminhada_ao_cliente=true`.
- Insere `mensagens` outbound no atendimento original (vira parte do histórico do cliente).

UI: botão "↗ Encaminhar ao cliente" em cada bolha do operador (Atrium). v1 = uma bolha por vez.

---

## Parte 4 — Higiene de navegação

- `useMensagensInternas.ts`: filtrar `conversa_id NOT LIKE 'demanda_%' AND NOT LIKE 'ponte_%'`. `/mensagens` volta a ser **só chat livre 1:1** (`pode_conversar_1a1`).
- Atrium: nova rota `/demandas` (lista + thread) com filtro por papel:
  - `admin` → tudo + filtro UI por setor/loja.
  - `setor_operador` → demandas do seu setor + as que abriu.
  - (lojas não acessam o Atrium).
- Sidebar Atrium: item "Demandas" condicional.

---

## Pontos confirmados pelo usuário

- ✅ Gerar link de pagamento = prerrogativa da loja via menu (Fluxo A); operador humano não dispara link manual.
- ✅ Admin vê tudo + filtro opcional.
- ✅ `/encerrar` mantido como atalho de texto além do botão.
- ✅ Lojas operam só pelo InFoco Messenger; nada no Atrium.
- ✅ Demanda em grupo funciona como grupo WhatsApp (todos veem todos).

## A confirmar (sugestões marcadas)

1. **Setor do operador CRM** que dispara Fluxo B: identificar no banco; provavelmente "Atendimento Virtual"/"CRM/Gael". → confirmo antes de codar.
2. **Grupo: snapshot vs dinâmico** → **snapshot** das lojas ativas no momento (lojas criadas depois não veem).
3. **Encaminhar ao cliente** → 1 bolha por vez agora; multi-seleção em v2.
4. **Resolver em grupo** → cada loja "resolve para si" (esconde local); operador/admin é quem fecha definitivamente.

---

## Arquivos

### Atrium (este projeto)
| Arquivo | Tipo | Mudança |
|---|---|---|
| `supabase/functions/criar-solicitacao-loja/index.ts` | NOVO | Porta lógica dormente de `bot-lojas` (Fluxo A) |
| `supabase/functions/criar-demanda-acionamento/index.ts` | NOVO | Cria demanda (loja única ou grupo) — Fluxo B |
| `supabase/functions/encaminhar-resposta-cliente/index.ts` | NOVO | Encaminha bolha de loja ao WhatsApp do cliente |
| `supabase/functions/encerrar-demanda-loja/index.ts` | EDIT | Aceita `encerrado_por: operador|loja|admin` |
| `src/components/atendimentos/AcionarLojaDialog.tsx` | NOVO | Dialog de abertura (loja/grupo) |
| `src/components/atendimentos/DemandaThreadPanel.tsx` | NOVO | Thread com header de grupo + encaminhar |
| `src/pages/Demandas.tsx` | NOVO | Lista + thread, filtros por papel (admin/setor) |
| `src/hooks/useDemandas.ts` | NOVO | Query escopada + realtime por `demanda_id` |
| `src/hooks/useMensagensInternas.ts` | EDIT | Filtra `demanda_*` e `ponte_*` |
| `src/App.tsx` | EDIT | Rota `/demandas` |
| `src/components/layout/AppSidebar.tsx` | EDIT | Item "Demandas" para operador/admin |
| Migration | NOVO | Trigger `trg_push_demanda_loja_nova`; índice GIN em `demandas_loja(metadata)` |

### InFoco Messenger (projeto `2d68a67b-...`, editado após aprovação)
| Arquivo | Tipo | Mudança |
|---|---|---|
| `src/pages/LojaNovaDemanda.tsx` | NOVO/AJUSTE | Wizard de menu corporativo (Fluxo A) |
| `src/pages/LojaMinhasDemandas.tsx` | NOVO | Cards do pipeline visíveis pra loja (read+comment) |
| `src/pages/DemandasList.tsx` | EDIT | Filtro por `loja_nome` + grupo, badge "Grupo" |
| `src/pages/DemandaChat.tsx` | NOVO | Thread em grupo (todas lojas + operador) |
| `src/App.tsx` | EDIT | Rotas + sidebar |

### Memória
- `mem://arquitetura/canal-unico-meta-e-app-atrium` — atualizar com 3 fluxos.
- `mem://demandas/fluxos-a-b-grupo` — novo, descreve A/B1/B2.
- Marcar `mem://bot-lojas/demandas-b2b-canal-evolution` definitivamente como deprecada.

### SQL
Sem alteração de schema. Tudo em cima de `solicitacoes`, `demandas_loja`, `demanda_mensagens`, `mensagens_internas`, `bot_fluxos`, `pipeline_colunas`. Apenas 1 trigger novo de push.
