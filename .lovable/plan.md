## Correção do roteamento "Gerar Link de Pagamento"

### Problema
Cards de link de pagamento criados pelo app InFoco Messenger caem em **"Confirmação PIX"** em vez de entrar no fluxo automático **Gerar link → Aguardando Pagamento → Link Pago**. Causa: `bot_fluxos.acao_final.coluna_destino` aponta para `"Link Enviado"` (coluna inativa); `criar-solicitacao-loja` não encontra e silenciosamente usa `cols[0]` (Confirmação PIX, ordem 0).

### Mudanças

**1. Corrigir config do fluxo (data)**
- `UPDATE bot_fluxos SET acao_final = jsonb_set(acao_final, '{coluna_destino}', '"Gerar link de Pagamento"') WHERE chave='link_pagamento'`.

**2. Reposicionar card órfão (data)**
- Mover `solicitacoes.id = 801c91dc-0185-4d44-a969-9d375dfab6e5` para a coluna `25c04205-5ce4-428c-b39c-e94e819f26f8` (Gerar link de Pagamento).
- Registrar evento em `pipeline_card_eventos` (`tipo=correcao_manual`) explicando a realocação.

**3. Hardening do fallback (código)**
- Arquivo: `supabase/functions/criar-solicitacao-loja/index.ts` (bloco "Resolve coluna destino").
- Quando `acao.coluna_destino` está definido mas não bate com nenhuma coluna **ativa** do setor → retornar **HTTP 500** com mensagem clara:
  `"Coluna destino '<X>' do fluxo '<chave>' não existe ou está inativa no setor."`
- Manter fallback para `cols[0]` **apenas** quando `acao.coluna_destino` está vazio (sem destino configurado).

### Fora de escopo
- Reorganizar/reativar a coluna antiga "Link Enviado".
- Ajustar duplicidade de `ordem=0` no setor Financeiro.
- Qualquer mudança visual no Kanban.

### Verificação
- `SELECT id, tipo, pipeline_coluna_id FROM solicitacoes WHERE pipeline_coluna_id = <id Confirmação PIX> AND tipo='link_pagamento'` → deve retornar 0 após a correção.
- Simular nova chamada `criar-solicitacao-loja` (fluxo `link_pagamento`) e conferir que o card nasce em "Gerar link de Pagamento".
