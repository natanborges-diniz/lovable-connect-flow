
-- 1. Create pipeline_automacoes table
CREATE TABLE public.pipeline_automacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_coluna_id uuid REFERENCES public.pipeline_colunas(id) ON DELETE CASCADE,
  entidade text NOT NULL DEFAULT 'contato', -- 'contato' or 'agendamento'
  status_alvo text, -- for agendamentos: the status value that triggers this
  tipo_acao text NOT NULL, -- 'enviar_template', 'enviar_mensagem', 'atualizar_campo', 'criar_tarefa'
  config jsonb NOT NULL DEFAULT '{}',
  ativo boolean NOT NULL DEFAULT true,
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pipeline_automacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage pipeline_automacoes"
  ON public.pipeline_automacoes FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- 2. Enable pg_net extension for HTTP calls from triggers
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- 3. Trigger function for agendamentos status change
CREATE OR REPLACE FUNCTION public.on_agendamento_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM extensions.http_post(
      url := current_setting('app.settings.supabase_url', true) || '/functions/v1/pipeline-automations',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body := jsonb_build_object(
        'entity_type', 'agendamento',
        'entity_id', NEW.id,
        'status_novo', NEW.status,
        'status_anterior', OLD.status
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_agendamento_status_change
  AFTER UPDATE ON public.agendamentos
  FOR EACH ROW
  EXECUTE FUNCTION public.on_agendamento_status_change();

-- 4. Trigger function for contatos pipeline_coluna_id change
CREATE OR REPLACE FUNCTION public.on_contato_coluna_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.pipeline_coluna_id IS DISTINCT FROM NEW.pipeline_coluna_id AND NEW.pipeline_coluna_id IS NOT NULL THEN
    PERFORM extensions.http_post(
      url := current_setting('app.settings.supabase_url', true) || '/functions/v1/pipeline-automations',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body := jsonb_build_object(
        'entity_type', 'contato',
        'entity_id', NEW.id,
        'coluna_id', NEW.pipeline_coluna_id,
        'coluna_anterior_id', OLD.pipeline_coluna_id
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_contato_coluna_change
  AFTER UPDATE ON public.contatos
  FOR EACH ROW
  EXECUTE FUNCTION public.on_contato_coluna_change();
