
-- 1) Tabela principal
CREATE TABLE public.pagamentos_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_link_id text NOT NULL UNIQUE,
  solicitacao_id uuid,
  contato_id uuid,
  atendimento_id uuid,
  loja_nome text,
  cod_empresa text,
  alias_loja text,
  cliente_nome text,
  cliente_telefone text,
  valor numeric(12,2),
  parcelas integer,
  descricao text,
  status text NOT NULL DEFAULT 'criado',
  tid text,
  nsu text,
  authorization_code text,
  last4 text,
  bandeira text,
  link_url text,
  enviado_at timestamptz,
  pago_at timestamptz,
  comprovante_recebido_at timestamptz,
  expirado_at timestamptz,
  comprovante_anexo_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pagamentos_link_loja_status ON public.pagamentos_link(loja_nome, status);
CREATE INDEX idx_pagamentos_link_contato ON public.pagamentos_link(contato_id);
CREATE INDEX idx_pagamentos_link_pago_at ON public.pagamentos_link(pago_at DESC);
CREATE INDEX idx_pagamentos_link_telefone ON public.pagamentos_link(cliente_telefone);
CREATE INDEX idx_pagamentos_link_solicitacao ON public.pagamentos_link(solicitacao_id);

ALTER TABLE public.pagamentos_link ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated manage pagamentos_link"
  ON public.pagamentos_link FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access pagamentos_link"
  ON public.pagamentos_link FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE TRIGGER trg_pagamentos_link_updated_at
  BEFORE UPDATE ON public.pagamentos_link
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Histórico de eventos
CREATE TABLE public.pagamentos_link_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pagamento_id uuid NOT NULL REFERENCES public.pagamentos_link(id) ON DELETE CASCADE,
  status_anterior text,
  status_novo text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pagamentos_link_eventos_pagamento ON public.pagamentos_link_eventos(pagamento_id, created_at DESC);

ALTER TABLE public.pagamentos_link_eventos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read pagamentos_link_eventos"
  ON public.pagamentos_link_eventos FOR SELECT TO authenticated USING (true);

CREATE POLICY "Service role full access pagamentos_link_eventos"
  ON public.pagamentos_link_eventos FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 3) Trigger de histórico
CREATE OR REPLACE FUNCTION public.trg_pagamentos_link_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.pagamentos_link_eventos(pagamento_id, status_anterior, status_novo, payload)
    VALUES (NEW.id, NULL, NEW.status, jsonb_build_object('valor', NEW.valor, 'tid', NEW.tid, 'nsu', NEW.nsu));
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.pagamentos_link_eventos(pagamento_id, status_anterior, status_novo, payload)
    VALUES (NEW.id, OLD.status, NEW.status, jsonb_build_object('valor', NEW.valor, 'tid', NEW.tid, 'nsu', NEW.nsu));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pagamentos_link_history
  AFTER INSERT OR UPDATE ON public.pagamentos_link
  FOR EACH ROW EXECUTE FUNCTION public.trg_pagamentos_link_history();

-- 4) Trigger pagamento confirmado -> evento_crm + tag comprador
CREATE OR REPLACE FUNCTION public.trg_pagamentos_link_pago()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'pago'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'pago')
     AND NEW.contato_id IS NOT NULL
  THEN
    INSERT INTO public.eventos_crm (contato_id, tipo, descricao, referencia_tipo, referencia_id, metadata)
    VALUES (
      NEW.contato_id,
      'pagamento_confirmado',
      'Pagamento confirmado: R$ ' || COALESCE(NEW.valor::text, '?') ||
        CASE WHEN NEW.loja_nome IS NOT NULL THEN ' — ' || NEW.loja_nome ELSE '' END,
      'pagamentos_link',
      NEW.id,
      jsonb_build_object('valor', NEW.valor, 'tid', NEW.tid, 'nsu', NEW.nsu, 'loja_nome', NEW.loja_nome, 'parcelas', NEW.parcelas)
    );

    UPDATE public.contatos
    SET tags = (
      SELECT array_agg(DISTINCT t)
      FROM unnest(COALESCE(tags, '{}'::text[]) || ARRAY['comprador']) AS t
    )
    WHERE id = NEW.contato_id
      AND NOT ('comprador' = ANY(COALESCE(tags, '{}'::text[])));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pagamentos_link_pago
  AFTER INSERT OR UPDATE ON public.pagamentos_link
  FOR EACH ROW EXECUTE FUNCTION public.trg_pagamentos_link_pago();

-- 5) Backfill a partir das solicitacoes existentes
INSERT INTO public.pagamentos_link (
  payment_link_id, solicitacao_id, contato_id, loja_nome, cod_empresa, alias_loja,
  cliente_nome, cliente_telefone, valor, parcelas, descricao, status,
  tid, nsu, authorization_code, last4, link_url,
  enviado_at, pago_at, comprovante_recebido_at, metadata, created_at
)
SELECT
  s.metadata->>'payment_link_id' AS payment_link_id,
  s.id,
  c.id AS contato_id,
  CASE WHEN s.metadata->>'alias_loja' ILIKE 'DINIZ %'
       THEN initcap(replace(s.metadata->>'alias_loja','DINIZ ','Diniz '))
       ELSE s.metadata->>'alias_loja' END,
  s.metadata->>'cod_empresa',
  s.metadata->>'alias_loja',
  COALESCE(s.metadata->>'cliente', s.metadata->>'nome_cliente'),
  s.metadata->>'cliente_whatsapp',
  NULLIF(regexp_replace(COALESCE(s.metadata->>'valor','0'), '[^0-9.,]', '', 'g'), '')::numeric,
  NULLIF(s.metadata->>'parcelas','')::int,
  s.metadata->>'descricao',
  CASE WHEN s.metadata->>'payment_status' = 'PAGO' THEN 'pago'
       WHEN s.status::text = 'concluida' THEN 'pago'
       ELSE 'enviado' END,
  s.metadata->>'tid',
  s.metadata->>'nsu',
  s.metadata->>'authorization',
  s.metadata->>'last4',
  s.metadata->>'url',
  s.created_at,
  CASE WHEN s.metadata ? 'payment_confirmed_at'
       THEN (s.metadata->>'payment_confirmed_at')::timestamptz END,
  CASE WHEN s.metadata ? 'comprovante_recebido_at'
       THEN (s.metadata->>'comprovante_recebido_at')::timestamptz END,
  s.metadata,
  s.created_at
FROM public.solicitacoes s
LEFT JOIN public.contatos c
  ON regexp_replace(COALESCE(c.telefone,''), '\D', '', 'g')
   = regexp_replace(COALESCE(s.metadata->>'cliente_whatsapp',''), '\D', '', 'g')
  AND length(regexp_replace(COALESCE(s.metadata->>'cliente_whatsapp',''), '\D', '', 'g')) > 0
WHERE s.tipo = 'link_pagamento'
  AND s.metadata ? 'payment_link_id'
ON CONFLICT (payment_link_id) DO NOTHING;
