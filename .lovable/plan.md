
# Comunicação interna corporativa — Loja↔Loja livre, Setor só por bot/função

## 1. Regras de ouro

1. **Toda interação de loja → setor (Financeiro, TI, Operacional, Administrativo) entra obrigatoriamente por um "fluxo" tipado** — equivalente ao que era o bot WhatsApp não-oficial. Nunca como conversa livre.
2. **Toda interação setor → loja** segue o mesmo princípio: passa por demanda tipada (já hoje via `criar-demanda-loja` quando o operador pede foto/confirmação).
3. **Loja ↔ Loja**: chat 1:1 livre no InFoco Messenger (ex.: gerente da Osasco trocando ideia com gerente do Carrefour).
4. **Colaborador ↔ Setor / Loja**: idem loja — só por fluxo tipado.
5. **Setor ↔ Setor (operadores internos)**: 1:1 livre entre membros do mesmo setor; cross-setor exige demanda.
6. **Notificações automáticas (cron, webhook)** continuam disparando, mas quando exigem ação viram demanda tipada (não notificação solta).

## 2. Tipo de usuário no InFoco Messenger

Hoje `app_role` tem `admin | operador | setor_usuario` e `user_roles` carrega `setor_id` e `loja_nome`. Falta um eixo claro de "que tipo de pessoa é esta no app". Adicionar coluna **`tipo_usuario`** em `profiles`:

| tipo_usuario | Quem é | O que pode no app |
|---|---|---|
| `loja` | Funcionário de loja física | Abre demandas pelo wizard; conversa 1:1 livre **só com outras lojas/colaboradores**; não vê lista de operadores de setor |
| `colaborador` | Colaborador interno (RH, marketing, gerência regional) | Abre demandas; conversa 1:1 com lojas e outros colaboradores |
| `setor_operador` | Operador de departamento (Financeiro, TI, Operacional, Atendimento) | Recebe demandas do seu setor; conversa 1:1 livre **só com outros operadores do mesmo setor**; **não pode iniciar 1:1 com lojas** (responde só dentro de demanda) |
| `admin` | Administrador | Sem restrição |

Setor + loja seguem em `user_roles`/`profiles.setor_id`. `tipo_usuario` é só o filtro de UX/segurança no app.

## 3. Reaproveitamento dos menus já existentes

Os 14 fluxos + 61 itens hierárquicos em `bot_fluxos` / `bot_menu_opcoes` ficam — só mudam de canal:

```
ANTES (descontinuado)
WhatsApp não oficial → bot-lojas EF → escolhe menu → cria solicitação

AGORA
InFoco Messenger → /demandas/nova (wizard) → mesmos menus → criar-demanda-loja EF
```

- `tipo_bot='loja'` → wizard do usuário `tipo_usuario='loja'`.
- `tipo_bot='colaborador'` → wizard do usuário `tipo_usuario='colaborador'`.
- `tipo_bot='departamento'` → wizard de setor abrindo demanda para outro setor (caso operador precise).
- Submenus (`menu_financeiro` → `sub_cobrancas` → `fin_link_pagamento`) viram navegação em 2-3 cliques no wizard, mantendo emojis e ordem.
- "Falar com a equipe" (`falar_equipe_*`) vira **"Abrir demanda livre para setor X"** — texto+anexo, ainda como demanda (com protocolo, status, SLA), nunca como chat solto.

## 4. Mudanças no backend (projeto Atrium)

### 4.1 Schema

1. Migração: `ALTER TABLE profiles ADD COLUMN tipo_usuario text NOT NULL DEFAULT 'setor_operador' CHECK (tipo_usuario IN ('loja','colaborador','setor_operador','admin'));`
2. Migração: backfill com base em `user_roles` (quem tem `loja_nome` → `loja`; quem tem `role='admin'` → `admin`; resto → `setor_operador`).
3. Vincular `bot_fluxos.setor_destino_id` aos setores reais (hoje todos NULL — corrigir via INSERT mapping pelos nomes dos fluxos: `link_pagamento/gerar_boleto/consulta_cpf/...` → Financeiro; `suporte_tecnico/impressao/autorizacao_dataweb` → TI; `confirmar_comparecimento` → Operacional/loja específica; etc.).

### 4.2 RLS em `mensagens_internas` (chat 1:1)

Nova policy `INSERT` substituindo a atual `Users can send messages`:

```
WITH CHECK (
  remetente_id = auth.uid()
  AND (
    -- conversas-sistema sempre permitidas (já controladas pelo backend)
    conversa_id LIKE 'demanda_%' OR conversa_id LIKE 'ponte_%'
    OR public.pode_conversar_1a1(auth.uid(), destinatario_id)
  )
)
```

Função SECURITY DEFINER `pode_conversar_1a1(remetente, destinatario)` retorna true quando:
- Algum dos dois é `admin`, OU
- Ambos `tipo_usuario IN ('loja','colaborador')`, OU
- Ambos `tipo_usuario='setor_operador'` E mesmo `setor_id`.

Loja↔setor_operador, colaborador↔setor_operador e setor_operador↔setor_operador-cross-setor: **bloqueado**.

### 4.3 Edge functions

- `criar-demanda-loja` ganha parâmetro opcional `tipo_solicitante` (`loja` | `colaborador` | `operador`) e `fluxo_chave` (uma das 14 chaves). Quando vier de loja/colaborador, valida que `solicitante_id` tem `tipo_usuario` compatível e roteia destinatários por `bot_fluxos.setor_destino_id` (em vez de só `loja_nome`). Backwards-compatible com chamadas atuais.
- `agendamentos-cron` (cobrança de comparecimento) e `payment-webhook` (picote): em vez de só `notificacoes`, abrem demanda tipada (`confirmar_comparecimento` / `comprovante_pagamento`) — assim a loja responde dentro de uma thread com protocolo, e fica rastreado.
- Novo `watchdog-sla-demandas` (cron `*/5`): marca demandas como `expirada` e notifica gestor do setor quando passa do SLA do `bot_fluxos`.

## 5. Mudanças no app InFoco Messenger (projeto 2d68a67b)

### 5.1 Navegação por `tipo_usuario`

```
loja / colaborador          setor_operador            admin
─────────────────────       ────────────────────      ──────
/                           /                         /
/demandas (minhas)          /demandas (do meu setor)  /demandas (todas)
/demandas/nova ⭐           — (sem botão "abrir")     /demandas/nova
/conversas (lojas/colabs)   /conversas (mesmo setor)  /conversas (todos)
/avisos                     /avisos                   /avisos
/perfil                     /perfil                   /perfil
```

### 5.2 Novo wizard `/demandas/nova`

Reutiliza `bot_fluxos` + `bot_menu_opcoes` lendo a mesma estrutura hierárquica:

```
Passo 1: tipo_bot do usuário define a árvore raiz
         (loja/colaborador/departamento)
Passo 2: navega submenus (Financeiro → Cobranças → Link de Pagamento)
Passo 3: form dinâmico com campos do fluxo (texto, anexo, valor, CPF, etc.)
Passo 4: confirma → POST criar-demanda-loja
         → demanda criada + push aos destinatários do setor
```

Mantém os emojis 1️⃣🔗📄 e ordem já cadastrada — zero retrabalho de UX.

### 5.3 Tela de conversas filtrada

`ConversasSidebar` filtra a lista de "novo contato" pelo `tipo_usuario` do logado:
- `loja`/`colaborador` → vê só profiles com `tipo_usuario IN ('loja','colaborador','admin')`.
- `setor_operador` → vê só profiles do mesmo `setor_id`.
- Admin → vê todos.

Também esconde conversas-demanda e conversas-ponte (já tratadas em rotas próprias).

### 5.4 Tela de demandas

- `loja`/`colaborador`: lista demandas `solicitante_id = auth.uid()` (as que abri) + as que foram abertas para a minha loja (`loja_nome` match).
- `setor_operador`: lista demandas do meu setor (`setor_destino_id` via JOIN com `bot_fluxos`).
- Cada item: protocolo, tipo, loja, SLA, status, último update.
- Bug fix: campos atuais `titulo`/`descricao` → `protocolo` + `pergunta`.

### 5.5 Tela de detalhe da demanda

Thread espelhada de `demanda_mensagens` (já alimentada pela `bridge-demanda`). Ações conforme tipo:
- Loja respondendo: campo de texto + anexo + comando `/encerrar`.
- Setor respondendo: idem + botão "Encerrar como resolvido".

## 6. Configurações (Atrium UI)

Em `/configuracoes`:

- **Aba "Tipos de Usuário"**: edita `profiles.tipo_usuario` por usuário (admin only).
- **Aba "Fluxos do bot"** (já existe `BotFluxosCard`): adicionar coluna `setor_destino_id` editável e SLA. Renomear visualmente para "Tipos de Demanda Interna".
- **Aba "Telefones e Lojas"**: já mapeia `loja_nome → setor_destino_id`, fica como referência cruzada.

## 7. Faseamento

1. **Fase 1 — Tipagem de usuário + RLS**
   Migração `tipo_usuario`, backfill, função `pode_conversar_1a1`, nova RLS em `mensagens_internas`. Já bloqueia conversa loja→setor.
2. **Fase 2 — Wizard "Nova Demanda" no InFoco Messenger**
   Reaproveita `bot_fluxos`/`bot_menu_opcoes`. Substitui a tela atual `/demandas` (que tem bug). Conecta em `criar-demanda-loja`.
3. **Fase 3 — Filtros de conversa por tipo + correção bug `/demandas`**
4. **Fase 4 — Roteamento por setor real**
   Preencher `bot_fluxos.setor_destino_id` (hoje todos NULL), estender `criar-demanda-loja` para rotear por setor além de loja.
5. **Fase 5 — Cron/Webhook viram demandas tipadas + watchdog SLA**
   `agendamentos-cron` e `payment-webhook` migram de notificações soltas para demandas com thread.

## 8. Detalhes técnicos rápidos

- **DB**: 1 migração (coluna + check), 2 funções SQL (`pode_conversar_1a1`, helper SLA), 1 RLS reescrita, 1 backfill via insert tool, 1 INSERT preenchendo `setor_destino_id` dos 14 fluxos.
- **Edge functions**: refactor leve em `criar-demanda-loja`, ajustes em `agendamentos-cron` e `payment-webhook`, novo `watchdog-sla-demandas`.
- **Atrium frontend**: pequena edição em `BotFluxosCard` + nova aba "Tipos de Usuário" em `Configuracoes.tsx`.
- **InFoco Messenger frontend**: nova rota `/demandas/nova` com wizard, refactor em `DemandasList`, filtro em `ConversasSidebar`, hook `useTipoUsuario` no AuthProvider.

## 9. Resultado final

- Loja entra no app → vê suas demandas + chat com outras lojas. Único caminho para falar com Financeiro/TI/Operacional é o botão **"Abrir Demanda"**, que reaproveita os 14 menus já desenhados.
- Setor recebe demandas tipadas, com protocolo e SLA. Não consegue ser "abordado" em chat solto.
- Operadores do mesmo setor conversam à vontade entre si (coordenação interna).
- Admin tem visão e ação totais.
- Os menus do antigo bot WhatsApp são preservados 100% — só trocam de superfície.

Posso começar pela Fase 1 (tipagem + RLS) assim que aprovar.
