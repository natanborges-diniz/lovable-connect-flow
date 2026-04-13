
-- Add parent_id for hierarchy
ALTER TABLE bot_menu_opcoes ADD COLUMN parent_id uuid REFERENCES bot_menu_opcoes(id) ON DELETE SET NULL;

-- Add tipo column (submenu, fluxo, falar_equipe)
ALTER TABLE bot_menu_opcoes ADD COLUMN tipo text NOT NULL DEFAULT 'fluxo';

-- Add setor_id for falar_equipe options
ALTER TABLE bot_menu_opcoes ADD COLUMN setor_id uuid REFERENCES setores(id) ON DELETE SET NULL;

-- Index for parent_id lookups
CREATE INDEX idx_bot_menu_opcoes_parent_id ON bot_menu_opcoes(parent_id);

-- Deactivate Atendimento Gael sector
UPDATE setores SET ativo = false, updated_at = now() WHERE id = '32cbd99c-4b20-4c8b-b7b2-901904d0aff6';

-- Deactivate its pipeline columns
UPDATE pipeline_colunas SET ativo = false, updated_at = now()
WHERE setor_id = '32cbd99c-4b20-4c8b-b7b2-901904d0aff6';
