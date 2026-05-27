---
name: Setor Estoque — Confirmação de Peças
description: Pipeline e fluxo Atrium do setor Estoque de Armações; card-por-loja, demanda Atrium com botões Tem/Não tem, watchdog 15min
type: feature
---
# Setor Estoque de Armações — Confirmação de peça em estoque

- **Setor ID:** `0e7b7572-4581-4e74-88eb-afca41ab71cf` (renomeado de "Dpto Armações" para "Estoque de Armações").
- **Rota:** `/estoque` (Kanban `PipelineEstoque.tsx`). Módulo `estoque` mapeado no `TopNavigation`, `AppSidebar`, `AppLayout` (`SETOR_ROUTES_MAP` aceita `armacoes`, `estoque armacoes`, `estoque`).
- **Tabela:** `confirmacoes_estoque` (protocolo `CEA-AAAA-NNNNN`, FK opcional `demanda_id`, status `aguardando|confirmada|sem_estoque|faturada|cancelada`, `proximo_lembrete_at`, `tentativas_lembrete`).
- **Storage:** bucket público `estoque-confirmacoes` (foto da peça opcional).
- **Colunas (tipo_acao):** `confirmacao_estoque_pendente` (Aguardando loja), `_ok` (Peça confirmada), `_sem` (Sem estoque), `_faturada` (Faturada), `_cancelada` (Cancelada), `garantias` (placeholder futuro).
- **Edge functions:**
  - `criar-confirmacao-estoque` — 1 card por loja + chama `criar-demanda-loja` com `loja_telefone="__INTERNO__"` (canal Atrium); marca `demandas_loja.tipo_chave='confirmacao_estoque'` + metadata `{confirmacao_estoque_id, referencia, codigo_produto, foto_url}`; agenda `proximo_lembrete_at = now()+15min`.
  - `responder-confirmacao-estoque` — input `{confirmacao_id, resposta:'sim'|'nao', observacao?}`; move card, posta msg na thread, encerra demanda (`encerrado_por='loja'`), notifica solicitante. Bloqueia se status != aguardando.
  - `watchdog-confirmacao-estoque` — cron 1min; reenvia notificação Atrium + push aos usuários da loja a cada 15min; após 4 tentativas (1h) cria tarefa de supervisão.
- **Frontend:**
  - `NovaConfirmacaoEstoqueDialog` (multi-loja, foto upload, ref* + cod*).
  - `DemandaThreadView` renderiza botões **✅ Tenho a peça** / **❌ Não tenho** + textarea de observação quando `tipo_chave='confirmacao_estoque'` e `demanda.status==='aberta'` (usa hook `useResponderConfirmacaoEstoque`).
- **Canal:** **somente Atrium** (sem WhatsApp para loja nesta fase). Cobrança 15min só via notificação interna + push.
- **Fora de escopo (futuro):** entrada de NF, fluxo completo de garantia, integração e-commerce automática.
