
ALTER TABLE public.os_recebimento_loja
  ADD COLUMN IF NOT EXISTS wa_status_reason text;

ALTER TABLE public.os_recebimento_loja REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'os_recebimento_loja'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.os_recebimento_loja';
  END IF;
END $$;
