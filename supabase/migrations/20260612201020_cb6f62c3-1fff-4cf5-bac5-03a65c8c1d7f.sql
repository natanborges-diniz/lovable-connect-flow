
-- storage.buckets: leitura pública dos metadados
DROP POLICY IF EXISTS "Public bucket metadata readable" ON storage.buckets;
CREATE POLICY "Public bucket metadata readable"
  ON storage.buckets FOR SELECT
  TO anon, authenticated
  USING (true);

-- storage.objects: policies para bucket solicitacao-anexos
DROP POLICY IF EXISTS "solicitacao-anexos public read" ON storage.objects;
CREATE POLICY "solicitacao-anexos public read"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'solicitacao-anexos');

DROP POLICY IF EXISTS "solicitacao-anexos auth insert" ON storage.objects;
CREATE POLICY "solicitacao-anexos auth insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'solicitacao-anexos');

DROP POLICY IF EXISTS "solicitacao-anexos auth update" ON storage.objects;
CREATE POLICY "solicitacao-anexos auth update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'solicitacao-anexos')
  WITH CHECK (bucket_id = 'solicitacao-anexos');

DROP POLICY IF EXISTS "solicitacao-anexos auth delete" ON storage.objects;
CREATE POLICY "solicitacao-anexos auth delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'solicitacao-anexos');
