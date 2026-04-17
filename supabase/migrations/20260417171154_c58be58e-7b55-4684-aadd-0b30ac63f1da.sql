-- 1) Cria os 3 submenus raiz para departamento (IDs determinísticos)
INSERT INTO bot_menu_opcoes (id, chave, titulo, emoji, fluxo, ordem, tipo, parent_id, tipo_bot, ativo)
VALUES
  ('b0000001-0000-0000-0000-000000000001', 'dept_menu_financeiro',  '💰 Financeiro',   '1️⃣', 'submenu', 1, 'submenu', NULL, 'departamento', true),
  ('b0000001-0000-0000-0000-000000000002', 'dept_menu_ti',          '🖥️ TI',          '2️⃣', 'submenu', 2, 'submenu', NULL, 'departamento', true),
  ('b0000001-0000-0000-0000-000000000003', 'dept_menu_operacional', '📋 Operacional',  '3️⃣', 'submenu', 3, 'submenu', NULL, 'departamento', true)
ON CONFLICT (id) DO UPDATE SET
  titulo = EXCLUDED.titulo, emoji = EXCLUDED.emoji, ordem = EXCLUDED.ordem, ativo = true;

-- 2) Cria 4 sub-categorias do Financeiro
INSERT INTO bot_menu_opcoes (id, chave, titulo, emoji, fluxo, ordem, tipo, parent_id, tipo_bot, ativo)
VALUES
  ('b0000002-0000-0000-0000-000000000001', 'dept_sub_cobrancas',     '💳 Cobranças',                '1️⃣', 'submenu', 1, 'submenu', 'b0000001-0000-0000-0000-000000000001', 'departamento', true),
  ('b0000002-0000-0000-0000-000000000002', 'dept_sub_estornos',      '↩️ Estornos e Devoluções',   '2️⃣', 'submenu', 2, 'submenu', 'b0000001-0000-0000-0000-000000000001', 'departamento', true),
  ('b0000002-0000-0000-0000-000000000003', 'dept_sub_confirmacoes',  '✅ Confirmações',             '3️⃣', 'submenu', 3, 'submenu', 'b0000001-0000-0000-0000-000000000001', 'departamento', true),
  ('b0000002-0000-0000-0000-000000000004', 'dept_sub_pagamentos',    '💵 Pagamentos',               '4️⃣', 'submenu', 4, 'submenu', 'b0000001-0000-0000-0000-000000000001', 'departamento', true)
ON CONFLICT (id) DO UPDATE SET
  titulo = EXCLUDED.titulo, emoji = EXCLUDED.emoji, ordem = EXCLUDED.ordem, parent_id = EXCLUDED.parent_id, ativo = true;

-- 3) Move fluxos existentes para sob suas categorias e ajusta ordem/emoji
-- Financeiro > Cobranças
UPDATE bot_menu_opcoes SET parent_id = 'b0000002-0000-0000-0000-000000000001', emoji = '1️⃣', ordem = 1
  WHERE chave = 'dept_link_pagamento' AND tipo_bot = 'departamento';
UPDATE bot_menu_opcoes SET parent_id = 'b0000002-0000-0000-0000-000000000001', emoji = '2️⃣', ordem = 2
  WHERE chave = 'dept_gerar_boleto' AND tipo_bot = 'departamento';
UPDATE bot_menu_opcoes SET parent_id = 'b0000002-0000-0000-0000-000000000001', emoji = '3️⃣', ordem = 3
  WHERE chave = 'dept_consulta_cpf' AND tipo_bot = 'departamento';

-- Financeiro > Estornos e Devoluções
UPDATE bot_menu_opcoes SET parent_id = 'b0000002-0000-0000-0000-000000000002', emoji = '1️⃣', ordem = 1
  WHERE chave = 'dept_estorno_pix_debito' AND tipo_bot = 'departamento';
UPDATE bot_menu_opcoes SET parent_id = 'b0000002-0000-0000-0000-000000000002', emoji = '2️⃣', ordem = 2
  WHERE chave = 'dept_estorno_cartao' AND tipo_bot = 'departamento';
UPDATE bot_menu_opcoes SET parent_id = 'b0000002-0000-0000-0000-000000000002', emoji = '3️⃣', ordem = 3
  WHERE chave = 'dept_devolucao_os' AND tipo_bot = 'departamento';

-- Financeiro > Confirmações
UPDATE bot_menu_opcoes SET parent_id = 'b0000002-0000-0000-0000-000000000003', emoji = '1️⃣', ordem = 1
  WHERE chave = 'dept_confirmacao_pix' AND tipo_bot = 'departamento';

-- Financeiro > Pagamentos
UPDATE bot_menu_opcoes SET parent_id = 'b0000002-0000-0000-0000-000000000004', emoji = '1️⃣', ordem = 1
  WHERE chave = 'dept_reembolso' AND tipo_bot = 'departamento';
UPDATE bot_menu_opcoes SET parent_id = 'b0000002-0000-0000-0000-000000000004', emoji = '2️⃣', ordem = 2
  WHERE chave = 'dept_pagamento' AND tipo_bot = 'departamento';

-- TI
UPDATE bot_menu_opcoes SET parent_id = 'b0000001-0000-0000-0000-000000000002', emoji = '1️⃣', ordem = 1
  WHERE chave = 'dept_suporte_tecnico' AND tipo_bot = 'departamento';
UPDATE bot_menu_opcoes SET parent_id = 'b0000001-0000-0000-0000-000000000002', emoji = '2️⃣', ordem = 2
  WHERE chave = 'dept_impressao' AND tipo_bot = 'departamento';
UPDATE bot_menu_opcoes SET parent_id = 'b0000001-0000-0000-0000-000000000002', emoji = '3️⃣', ordem = 3
  WHERE chave = 'dept_autorizacao_dataweb' AND tipo_bot = 'departamento';

-- Operacional
UPDATE bot_menu_opcoes SET parent_id = 'b0000001-0000-0000-0000-000000000003', emoji = '1️⃣', ordem = 1
  WHERE chave = 'dept_confirmar_comparecimento' AND tipo_bot = 'departamento';

-- 4) Adiciona "Falar com a equipe" em cada submenu de categoria
INSERT INTO bot_menu_opcoes (id, chave, titulo, emoji, fluxo, ordem, tipo, parent_id, setor_id, tipo_bot, ativo)
SELECT 'b0000003-0000-0000-0000-000000000001', 'dept_falar_equipe_financeiro', '💬 Falar com a equipe', '5️⃣', 'falar_equipe', 5, 'falar_equipe', 'b0000001-0000-0000-0000-000000000001', s.id, 'departamento', true
FROM setores s WHERE LOWER(s.nome) = 'financeiro' LIMIT 1
ON CONFLICT (id) DO UPDATE SET parent_id = EXCLUDED.parent_id, ativo = true;

INSERT INTO bot_menu_opcoes (id, chave, titulo, emoji, fluxo, ordem, tipo, parent_id, setor_id, tipo_bot, ativo)
SELECT 'b0000003-0000-0000-0000-000000000002', 'dept_falar_equipe_ti', '💬 Falar com a equipe', '4️⃣', 'falar_equipe', 4, 'falar_equipe', 'b0000001-0000-0000-0000-000000000002', s.id, 'departamento', true
FROM setores s WHERE LOWER(s.nome) = 'ti' LIMIT 1
ON CONFLICT (id) DO UPDATE SET parent_id = EXCLUDED.parent_id, ativo = true;

INSERT INTO bot_menu_opcoes (id, chave, titulo, emoji, fluxo, ordem, tipo, parent_id, tipo_bot, ativo)
VALUES ('b0000003-0000-0000-0000-000000000003', 'dept_falar_equipe_operacional', '💬 Falar com a equipe', '2️⃣', 'falar_equipe', 2, 'falar_equipe', 'b0000001-0000-0000-0000-000000000003', 'departamento', true)
ON CONFLICT (id) DO UPDATE SET parent_id = EXCLUDED.parent_id, ativo = true;