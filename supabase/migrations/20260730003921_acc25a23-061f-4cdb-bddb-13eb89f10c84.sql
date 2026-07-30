-- 1) Colunas Pix em pagamentos_link
ALTER TABLE public.pagamentos_link
  ADD COLUMN IF NOT EXISTS metodo text NOT NULL DEFAULT 'cartao',
  ADD COLUMN IF NOT EXISTS pix_txid text,
  ADD COLUMN IF NOT EXISTS pix_copia_cola text,
  ADD COLUMN IF NOT EXISTS pix_qrcode_url text,
  ADD COLUMN IF NOT EXISTS pix_e2e_id text,
  ADD COLUMN IF NOT EXISTS pix_expira_at timestamptz,
  ADD COLUMN IF NOT EXISTS pix_pago_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pagamentos_link_metodo_check'
  ) THEN
    ALTER TABLE public.pagamentos_link
      ADD CONSTRAINT pagamentos_link_metodo_check CHECK (metodo IN ('cartao','pix'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_pagamentos_link_pix_txid ON public.pagamentos_link (pix_txid);
CREATE INDEX IF NOT EXISTS idx_pagamentos_link_metodo_status ON public.pagamentos_link (metodo, status);

COMMENT ON COLUMN public.pagamentos_link.metodo IS 'cartao (link Rede) ou pix (cobranca BTG)';
COMMENT ON COLUMN public.pagamentos_link.pix_txid IS 'txid da cobranca Pix no PSP (BTG)';
COMMENT ON COLUMN public.pagamentos_link.pix_e2e_id IS 'EndToEndId da liquidacao Pix';

-- 2) Colunas "Pix Enviado" / "Pix Pago" no pipeline do Financeiro
INSERT INTO public.pipeline_colunas (setor_id, nome, ordem, ativo)
SELECT s.id, v.nome, v.ordem, true
FROM public.setores s
CROSS JOIN (VALUES ('Pix Enviado', 20), ('Pix Pago', 21)) AS v(nome, ordem)
WHERE s.nome = 'Financeiro'
  AND NOT EXISTS (
    SELECT 1 FROM public.pipeline_colunas pc
    WHERE pc.setor_id = s.id AND pc.nome = v.nome
  );

-- 3) Fluxo pix_pagamento no bot + itens de menu
INSERT INTO public.bot_fluxos (chave, nome, tipo_bot, descricao, setor_destino_id, etapas, acao_final, ativo)
SELECT
  'pix_pagamento',
  'Gerar Cobrança Pix',
  'loja',
  'Gera cobrança Pix automática (BTG) e envia ao cliente por WhatsApp',
  (SELECT id FROM public.setores WHERE nome = 'Financeiro'),
  '[
    {"campo":"valor","mensagem":"⚡ *Gerar Cobrança Pix*\n\nQual o *valor* da cobrança? (ex: 150.00)","tipo_input":"decimal","validacao":{"min":0.01},"obrigatorio":true},
    {"campo":"descricao","mensagem":"📝 Descreva o pagamento (ex: Lente Transition CR39)","tipo_input":"texto","validacao":{"min_length":3},"obrigatorio":true},
    {"campo":"cliente","mensagem":"👤 Nome do cliente","tipo_input":"texto","validacao":{"min_length":2},"obrigatorio":true},
    {"campo":"cliente_whatsapp","mensagem":"📱 WhatsApp do cliente (com DDD, ex: 11999998888)\nO Pix será enviado diretamente para este número.","tipo_input":"texto","validacao":{"min_length":10,"max_length":15},"obrigatorio":true}
  ]'::jsonb,
  '{
    "tipo":"criar_solicitacao",
    "endpoint":"pix-charges",
    "coluna_destino":"Pix Enviado",
    "tipo_solicitacao":"pix_pagamento",
    "template_confirmacao":"✅ *Cobrança Pix gerada!*\n\n💰 R$ {{valor}}\n📝 {{descricao}}\n⏰ Válida por 24h\n\nO cliente já recebeu o QR Code no WhatsApp."
  }'::jsonb,
  true
WHERE NOT EXISTS (SELECT 1 FROM public.bot_fluxos WHERE chave = 'pix_pagamento');

INSERT INTO public.bot_menu_opcoes (chave, titulo, emoji, descricao, fluxo, ordem, ativo, tipo_bot, parent_id, tipo, setor_id, usuarios_visiveis)
SELECT v.chave, v.titulo, v.emoji, v.descricao, 'pix_pagamento', v.ordem, true, v.tipo_bot, v.parent_id::uuid, 'fluxo', v.setor_id::uuid, m.usuarios_visiveis
FROM (VALUES
  ('fin_pix_pagamento',  '⚡ Cobrança Pix', '3️⃣', 'Gerar cobrança Pix automática', 3, 'loja',         'a0000002-0000-0000-0000-000000000001', '7cd0d465-bb9d-4097-a1ae-93106fb82d48'),
  ('dept_pix_pagamento', '⚡ Cobrança Pix', '3️⃣', 'Gerar cobrança Pix automática', 3, 'departamento', 'b0000002-0000-0000-0000-000000000001', NULL)
) AS v(chave, titulo, emoji, descricao, ordem, tipo_bot, parent_id, setor_id)
JOIN public.bot_menu_opcoes m ON m.id = v.parent_id::uuid
WHERE NOT EXISTS (SELECT 1 FROM public.bot_menu_opcoes b WHERE b.chave = v.chave);

-- 4) Alias/função do template Pix
UPDATE public.whatsapp_templates
SET funcao_alvo = 'pix_pagamento', updated_at = now()
WHERE nome = 'pix_pagamento_cliente_v1';