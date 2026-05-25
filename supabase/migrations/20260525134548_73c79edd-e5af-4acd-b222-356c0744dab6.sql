
-- 1. Drop anon SELECT on fluxo_responsaveis (internal staff data — no public surface).
DROP POLICY IF EXISTS "Anon can read fluxo_responsaveis" ON public.fluxo_responsaveis;

-- 2. Restrict whatsapp-media INSERT to service_role only (currently exposed to "public").
DROP POLICY IF EXISTS "Allow service role uploads on whatsapp-media" ON storage.objects;
CREATE POLICY "Allow service role uploads on whatsapp-media"
ON storage.objects
FOR INSERT
TO service_role
WITH CHECK (bucket_id = 'whatsapp-media');

-- 3. Stop spoofable notification inserts from authenticated clients.
--    Service role retains full access via existing policy.
DROP POLICY IF EXISTS "Authenticated can insert notificacoes" ON public.notificacoes;

-- 4. Lock down mutable search_path on grupo_id_from_conversa.
CREATE OR REPLACE FUNCTION public.grupo_id_from_conversa(_conversa_id text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $function$
  SELECT CASE
    WHEN _conversa_id LIKE 'grupo_%' THEN substring(_conversa_id from 7)::uuid
    ELSE NULL
  END;
$function$;

-- 5. Recreate funil_metricas_vendas with security_invoker=true so it honors caller's RLS.
DROP VIEW IF EXISTS public.funil_metricas_vendas;
CREATE VIEW public.funil_metricas_vendas
WITH (security_invoker = true)
AS
  SELECT pc.grupo_funil,
     pc.ordem AS grupo_ordem,
     pc.nome AS coluna_nome,
     c.ciclo_funil,
     count(c.id) AS total_contatos
    FROM contatos c
      JOIN pipeline_colunas pc ON c.pipeline_coluna_id = pc.id
   WHERE pc.ativo = true AND pc.setor_id IS NULL
   GROUP BY pc.grupo_funil, pc.ordem, pc.nome, c.ciclo_funil
   ORDER BY pc.ordem, c.ciclo_funil;
