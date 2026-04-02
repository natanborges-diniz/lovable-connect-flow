
-- Step 1: Merge duplicate contatos - keep the oldest one per telefone
-- Update atendimentos to point to the oldest contato
WITH duplicates AS (
  SELECT telefone,
         min(created_at) AS oldest_created,
         (array_agg(id ORDER BY created_at ASC))[1] AS keep_id,
         array_remove(array_agg(id ORDER BY created_at ASC), (array_agg(id ORDER BY created_at ASC))[1]) AS remove_ids
  FROM public.contatos
  WHERE telefone IS NOT NULL
  GROUP BY telefone
  HAVING count(*) > 1
)
UPDATE public.atendimentos a
SET contato_id = d.keep_id
FROM duplicates d
WHERE a.contato_id = ANY(d.remove_ids);

-- Update solicitacoes to point to the oldest contato
WITH duplicates AS (
  SELECT telefone,
         (array_agg(id ORDER BY created_at ASC))[1] AS keep_id,
         array_remove(array_agg(id ORDER BY created_at ASC), (array_agg(id ORDER BY created_at ASC))[1]) AS remove_ids
  FROM public.contatos
  WHERE telefone IS NOT NULL
  GROUP BY telefone
  HAVING count(*) > 1
)
UPDATE public.solicitacoes s
SET contato_id = d.keep_id
FROM duplicates d
WHERE s.contato_id = ANY(d.remove_ids);

-- Update agendamentos
WITH duplicates AS (
  SELECT telefone,
         (array_agg(id ORDER BY created_at ASC))[1] AS keep_id,
         array_remove(array_agg(id ORDER BY created_at ASC), (array_agg(id ORDER BY created_at ASC))[1]) AS remove_ids
  FROM public.contatos
  WHERE telefone IS NOT NULL
  GROUP BY telefone
  HAVING count(*) > 1
)
UPDATE public.agendamentos ag
SET contato_id = d.keep_id
FROM duplicates d
WHERE ag.contato_id = ANY(d.remove_ids);

-- Update canais
WITH duplicates AS (
  SELECT telefone,
         (array_agg(id ORDER BY created_at ASC))[1] AS keep_id,
         array_remove(array_agg(id ORDER BY created_at ASC), (array_agg(id ORDER BY created_at ASC))[1]) AS remove_ids
  FROM public.contatos
  WHERE telefone IS NOT NULL
  GROUP BY telefone
  HAVING count(*) > 1
)
UPDATE public.canais c
SET contato_id = d.keep_id
FROM duplicates d
WHERE c.contato_id = ANY(d.remove_ids);

-- Update eventos_crm
WITH duplicates AS (
  SELECT telefone,
         (array_agg(id ORDER BY created_at ASC))[1] AS keep_id,
         array_remove(array_agg(id ORDER BY created_at ASC), (array_agg(id ORDER BY created_at ASC))[1]) AS remove_ids
  FROM public.contatos
  WHERE telefone IS NOT NULL
  GROUP BY telefone
  HAVING count(*) > 1
)
UPDATE public.eventos_crm e
SET contato_id = d.keep_id
FROM duplicates d
WHERE e.contato_id = ANY(d.remove_ids);

-- Step 2: Delete duplicate contatos (keep oldest)
WITH duplicates AS (
  SELECT telefone,
         (array_agg(id ORDER BY created_at ASC))[1] AS keep_id,
         array_remove(array_agg(id ORDER BY created_at ASC), (array_agg(id ORDER BY created_at ASC))[1]) AS remove_ids
  FROM public.contatos
  WHERE telefone IS NOT NULL
  GROUP BY telefone
  HAVING count(*) > 1
)
DELETE FROM public.contatos
WHERE id IN (SELECT unnest(remove_ids) FROM duplicates);

-- Step 3: Create unique index to prevent future duplicates
CREATE UNIQUE INDEX idx_contatos_telefone_unique ON public.contatos (telefone) WHERE telefone IS NOT NULL;
