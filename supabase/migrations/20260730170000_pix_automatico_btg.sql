-- ═══════════════════════════════════════════════════════════════════
-- Pix automático (BTG via Optical Business) — complemento.
-- A base foi aplicada pela 20260730003921 (colunas metodo/pix_txid/
-- pix_copia_cola/pix_e2e_id/pix_expira_at/pix_pago_at em pagamentos_link,
-- colunas "Pix Enviado"/"Pix Pago" no pipeline, fluxo pix_pagamento no bot
-- e menus). Aqui entra apenas o que faltou:
--   1) dados do pagador no espelho financeiro (usados no picote/relatórios)
--   2) alias do template WhatsApp (criar-solicitacao-loja envia por alias)
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.pagamentos_link
  ADD COLUMN IF NOT EXISTS pagador_nome text,
  ADD COLUMN IF NOT EXISTS pagador_documento text;

-- Alias usado pelo criar-solicitacao-loja (send-whatsapp-template resolve
-- via template_aliases). O template pix_pagamento_cliente_v1 já foi
-- submetido à Meta (UTILITY, pt_BR, 3 params: protocolo, valor, link).
INSERT INTO public.template_aliases (alias, template_nome, descricao)
VALUES (
  'pix_pagamento_cliente',
  'pix_pagamento_cliente_v1',
  'Cobrança Pix para cliente final: {{1}} protocolo, {{2}} valor, {{3}} link da página de pagamento (QR + copia-e-cola)'
)
ON CONFLICT (alias) DO NOTHING;
