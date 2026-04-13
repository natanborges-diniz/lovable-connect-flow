
-- Create internal messages table
CREATE TABLE public.mensagens_internas (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  remetente_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  destinatario_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  conversa_id text NOT NULL,
  conteudo text NOT NULL,
  lida boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.mensagens_internas ENABLE ROW LEVEL SECURITY;

-- SELECT: user can see messages they sent or received
CREATE POLICY "Users can view own messages"
  ON public.mensagens_internas FOR SELECT
  TO authenticated
  USING (remetente_id = auth.uid() OR destinatario_id = auth.uid());

-- INSERT: user can only send as themselves
CREATE POLICY "Users can send messages"
  ON public.mensagens_internas FOR INSERT
  TO authenticated
  WITH CHECK (remetente_id = auth.uid());

-- UPDATE: recipient can mark as read
CREATE POLICY "Recipients can mark as read"
  ON public.mensagens_internas FOR UPDATE
  TO authenticated
  USING (destinatario_id = auth.uid());

-- Service role full access
CREATE POLICY "Service role full access mensagens_internas"
  ON public.mensagens_internas FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Indexes
CREATE INDEX idx_mensagens_internas_conversa ON public.mensagens_internas (conversa_id, created_at DESC);
CREATE INDEX idx_mensagens_internas_destinatario_lida ON public.mensagens_internas (destinatario_id, lida) WHERE lida = false;

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.mensagens_internas;
