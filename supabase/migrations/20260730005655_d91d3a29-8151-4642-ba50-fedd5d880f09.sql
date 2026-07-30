ALTER TABLE public.pagamentos_link
  ADD COLUMN IF NOT EXISTS pagador_nome text,
  ADD COLUMN IF NOT EXISTS pagador_documento text;

INSERT INTO public.template_aliases (alias, template_nome, descricao)
VALUES (
  'pix_pagamento_cliente',
  'pix_pagamento_cliente_v1',
  'Cobrança Pix para cliente final: {{1}} protocolo, {{2}} valor, {{3}} link da página de pagamento (QR + copia-e-cola)'
)
ON CONFLICT (alias) DO NOTHING;