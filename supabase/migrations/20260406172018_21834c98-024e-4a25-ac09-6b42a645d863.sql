-- 1. Add ciclo_funil to contatos
ALTER TABLE public.contatos ADD COLUMN IF NOT EXISTS ciclo_funil integer NOT NULL DEFAULT 1;

-- 2. Add grupo_funil to pipeline_colunas
ALTER TABLE public.pipeline_colunas ADD COLUMN IF NOT EXISTS grupo_funil text;

-- 3. Create "Redirecionado" column (terminal)
INSERT INTO public.pipeline_colunas (nome, cor, ordem, ativo, setor_id, grupo_funil)
VALUES ('Redirecionado', 'muted-foreground', 91, true, NULL, 'terminal')
ON CONFLICT DO NOTHING;

-- 4. Update grupo_funil and ordem for all existing sales columns
UPDATE public.pipeline_colunas SET grupo_funil = 'triagem', ordem = 0 WHERE id = '878c97b4-764e-4b37-8d9d-44bc66c941e9'; -- Novo Contato
UPDATE public.pipeline_colunas SET grupo_funil = 'triagem', ordem = 1 WHERE id = '225e0b0a-b324-422b-889f-f7bc2433cf57'; -- Retorno
UPDATE public.pipeline_colunas SET grupo_funil = 'comercial', ordem = 10 WHERE id = 'fada1f1f-4247-4353-a61e-b1a9ca7737fa'; -- Lead
UPDATE public.pipeline_colunas SET grupo_funil = 'comercial', ordem = 11 WHERE id = 'ed72254a-5af0-48d6-b2fb-ca236af428bf'; -- Qualificado
UPDATE public.pipeline_colunas SET grupo_funil = 'comercial', ordem = 12 WHERE id = '8216d851-6f58-4f16-9273-76c0d3f09d33'; -- Orçamento
UPDATE public.pipeline_colunas SET grupo_funil = 'comercial', ordem = 13 WHERE id = '28436fa2-c87e-4370-90ea-099dd07776c5'; -- Agendamento
UPDATE public.pipeline_colunas SET grupo_funil = 'pos_venda', ordem = 20 WHERE id = 'cad20aaf-5fe4-43c9-9818-476c571a55e4'; -- Informações Gerais
UPDATE public.pipeline_colunas SET grupo_funil = 'sac', ordem = 30 WHERE id = 'cf5dcd99-f0ac-4d2b-8307-cd80434663c4'; -- Reclamações
UPDATE public.pipeline_colunas SET grupo_funil = 'outros', ordem = 40 WHERE id = '64479ab0-224e-4290-8fba-b5d854fab563'; -- Parcerias
UPDATE public.pipeline_colunas SET grupo_funil = 'outros', ordem = 41 WHERE id = '6280b85d-85c0-42e3-a4c4-3398167277c5'; -- Compras
UPDATE public.pipeline_colunas SET grupo_funil = 'terminal', ordem = 90 WHERE id = '6ed356cd-0ba2-45f7-874e-4229cbc1bcb6'; -- Atendimento Humano
UPDATE public.pipeline_colunas SET grupo_funil = 'terminal', ordem = 92 WHERE id = 'e3893ea7-2577-4ec7-9fe9-c7c09e75ead3'; -- Perdidos

-- 5. Create funnel metrics view
CREATE OR REPLACE VIEW public.funil_metricas_vendas AS
SELECT
  pc.grupo_funil,
  pc.ordem AS grupo_ordem,
  pc.nome AS coluna_nome,
  c.ciclo_funil,
  COUNT(c.id) AS total_contatos
FROM public.contatos c
JOIN public.pipeline_colunas pc ON c.pipeline_coluna_id = pc.id
WHERE pc.ativo = true AND pc.setor_id IS NULL
GROUP BY pc.grupo_funil, pc.ordem, pc.nome, c.ciclo_funil
ORDER BY pc.ordem, c.ciclo_funil;