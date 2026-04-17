UPDATE public.setores
SET nome = 'Atendimento Corporativo', ativo = true, updated_at = now()
WHERE id = '32cbd99c-4b20-4c8b-b7b2-901904d0aff6';

UPDATE public.pipeline_colunas
SET ativo = true, updated_at = now()
WHERE setor_id = '32cbd99c-4b20-4c8b-b7b2-901904d0aff6';