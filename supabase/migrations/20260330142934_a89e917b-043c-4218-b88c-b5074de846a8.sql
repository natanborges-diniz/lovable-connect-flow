INSERT INTO storage.buckets (id, name, public)
VALUES ('cpf-documentos', 'cpf-documentos', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated users can upload cpf docs"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'cpf-documentos');

CREATE POLICY "Authenticated users can read cpf docs"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'cpf-documentos');

CREATE POLICY "Authenticated users can delete cpf docs"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'cpf-documentos');