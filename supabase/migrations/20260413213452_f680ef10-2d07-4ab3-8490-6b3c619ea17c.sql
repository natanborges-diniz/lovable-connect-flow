
-- Deactivate the two columns
UPDATE pipeline_colunas SET ativo = false, updated_at = now()
WHERE id IN ('6ed356cd-0ba2-45f7-874e-4229cbc1bcb6', '137630dc-7c74-4bab-95b7-d31f7df83150');

-- Move orphan contacts: ciclo_funil = 1 → Novo Contato, ciclo_funil >= 2 → Retorno
UPDATE contatos SET pipeline_coluna_id = '878c97b4-764e-4b37-8d9d-44bc66c941e9', updated_at = now()
WHERE pipeline_coluna_id IN ('6ed356cd-0ba2-45f7-874e-4229cbc1bcb6', '137630dc-7c74-4bab-95b7-d31f7df83150')
  AND ciclo_funil = 1;

UPDATE contatos SET pipeline_coluna_id = '225e0b0a-b324-422b-889f-f7bc2433cf57', updated_at = now()
WHERE pipeline_coluna_id IN ('6ed356cd-0ba2-45f7-874e-4229cbc1bcb6', '137630dc-7c74-4bab-95b7-d31f7df83150')
  AND ciclo_funil >= 2;

-- Deactivate automations linked to those columns
UPDATE pipeline_automacoes SET ativo = false, updated_at = now()
WHERE pipeline_coluna_id IN ('6ed356cd-0ba2-45f7-874e-4229cbc1bcb6', '137630dc-7c74-4bab-95b7-d31f7df83150');
