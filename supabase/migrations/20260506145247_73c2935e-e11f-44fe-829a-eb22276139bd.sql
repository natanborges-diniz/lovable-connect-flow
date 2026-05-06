-- Mensagens (WhatsApp/cliente)
ALTER TABLE public.mensagens
  ADD COLUMN IF NOT EXISTS editada_at timestamptz,
  ADD COLUMN IF NOT EXISTS deletada_at timestamptz,
  ADD COLUMN IF NOT EXISTS deletada_por uuid;

-- Mensagens internas (chat 1:1)
ALTER TABLE public.mensagens_internas
  ADD COLUMN IF NOT EXISTS editada_at timestamptz,
  ADD COLUMN IF NOT EXISTS deletada_at timestamptz,
  ADD COLUMN IF NOT EXISTS deletada_por uuid;

-- Demanda mensagens (thread interno de demanda)
ALTER TABLE public.demanda_mensagens
  ADD COLUMN IF NOT EXISTS editada_at timestamptz,
  ADD COLUMN IF NOT EXISTS deletada_at timestamptz,
  ADD COLUMN IF NOT EXISTS deletada_por uuid;

-- RLS: autor pode UPDATE em mensagens_internas (a tabela só tinha INSERT/SELECT/UPDATE-lida)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'mensagens_internas'
      AND policyname = 'Authors can edit own messages'
  ) THEN
    CREATE POLICY "Authors can edit own messages"
      ON public.mensagens_internas
      FOR UPDATE
      TO authenticated
      USING (remetente_id = auth.uid())
      WITH CHECK (remetente_id = auth.uid());
  END IF;
END$$;