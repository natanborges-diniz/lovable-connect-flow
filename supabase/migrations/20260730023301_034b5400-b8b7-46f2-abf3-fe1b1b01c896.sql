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

-- 3) Template v2 com copia-e-cola no corpo
UPDATE public.template_aliases
SET template_nome = 'pix_pagamento_cliente_v2',
    descricao = 'Cobrança Pix: {{1}} protocolo, {{2}} valor, {{3}} Pix copia-e-cola, {{4}} link da página (QR + status)',
    atualizado_em = now()
WHERE alias = 'pix_pagamento_cliente';