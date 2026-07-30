-- ═══════════════════════════════════════════════════════════════════
-- Ajustes do fluxo Pix após teste piloto:
-- 1) O registro pix_pagamento em bot_fluxos pré-existia ao seed (criado via
--    UI) com endpoint "payment-links" — o teste de R$0,01 gerou link de
--    CARTÃO (/pay) em vez de cobrança Pix. Força a configuração correta.
-- 2) Campo descrição sem exemplo de produto e pré-preenchido "Óticas Diniz"
--    (produtos nunca vão na descrição — já vão na nota do cliente), tanto
--    no Pix quanto no link de pagamento cartão.
-- 3) Alias do template WhatsApp passa a apontar para a v2, que traz o
--    copia-e-cola no corpo da mensagem ({{3}}) além do link da página.
-- ═══════════════════════════════════════════════════════════════════

-- 1) Endpoint/rota corretos do fluxo Pix
UPDATE public.bot_fluxos
SET acao_final = acao_final || jsonb_build_object(
      'tipo', 'criar_solicitacao',
      'endpoint', 'pix-charges',
      'tipo_solicitacao', 'pix_pagamento',
      'coluna_destino', 'Pix Enviado'
    ),
    ativo = true
WHERE chave = 'pix_pagamento';

-- 2) Descrição: sem exemplo de produto, pré-preenchida "Óticas Diniz"
UPDATE public.bot_fluxos f
SET etapas = (
  SELECT jsonb_agg(
    CASE WHEN et->>'campo' = 'descricao'
      THEN et || jsonb_build_object(
        'mensagem', '📝 Descrição da cobrança (aparece para o cliente no pagamento)',
        'valor_default', 'Óticas Diniz'
      )
      ELSE et
    END
  )
  FROM jsonb_array_elements(f.etapas) AS et
)
WHERE chave IN ('pix_pagamento', 'link_pagamento')
  AND etapas @> '[]'::jsonb;

-- 3) Template v2 com copia-e-cola no corpo (4 parâmetros:
--    protocolo, valor, copia-e-cola, link da página)
UPDATE public.template_aliases
SET template_nome = 'pix_pagamento_cliente_v2',
    descricao = 'Cobrança Pix: {{1}} protocolo, {{2}} valor, {{3}} Pix copia-e-cola, {{4}} link da página (QR + status)',
    atualizado_em = now()
WHERE alias = 'pix_pagamento_cliente';
