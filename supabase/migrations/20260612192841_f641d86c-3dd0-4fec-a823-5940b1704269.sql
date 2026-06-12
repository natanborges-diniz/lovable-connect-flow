-- storage.buckets tem RLS ligada sem policies, bloqueando getBucket() do SDK.
-- Restaurar policy de leitura padrão (metadados de bucket são públicos por design no Supabase).
CREATE POLICY "Public bucket metadata readable"
  ON storage.buckets FOR SELECT
  TO anon, authenticated
  USING (true);