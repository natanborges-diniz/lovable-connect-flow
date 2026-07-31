-- ═══════════════════════════════════════════════════════════════════════════
-- Consultoria Gael — Jul/2026
-- P0.1: Fila de atendimento humano visível no CRM Vendas
-- P1.1: Remoção definitiva do modo híbrido (com trava contra reintrodução)
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Coluna "Atendimento Humano" no CRM Vendas (setor_id NULL = visível em /crm).
--    Todos os escalonamentos passam a mover o card para cá (função
--    escalarParaHumano no ai-triage), tornando a fila visível no kanban.
INSERT INTO public.pipeline_colunas (nome, cor, ordem, setor_id, ativo)
SELECT 'Atendimento Humano', 'destructive', 1, NULL, true
WHERE NOT EXISTS (
  SELECT 1 FROM public.pipeline_colunas
  WHERE nome = 'Atendimento Humano' AND setor_id IS NULL
);

-- 2) Saneamento: nenhum atendimento pode permanecer em modo 'hibrido'.
--    Ativos viram 'humano' (ficam na fila); encerrados idem (só histórico).
UPDATE public.atendimentos SET modo = 'humano' WHERE modo = 'hibrido';

-- 3) Trava contra reintrodução silenciosa do híbrido (já voltou uma vez após
--    a migration de 17/04). A partir daqui o banco rejeita o valor.
ALTER TABLE public.atendimentos DROP CONSTRAINT IF EXISTS atendimentos_modo_check;
ALTER TABLE public.atendimentos
  ADD CONSTRAINT atendimentos_modo_check CHECK (modo IN ('ia', 'humano', 'ponte'));

-- 4) Fallback de notificação de escalação: hoje aponta para 1 único usuário —
--    ponto único de falha (escalações noturnas sem ninguém notificado).
--    Passa a incluir também todos os admins ativos, preservando os user_ids já
--    configurados. Ajuste fino pode ser feito depois na tela de Configurações.
UPDATE public.configuracoes_ia
SET valor = (
  jsonb_set(
    COALESCE(NULLIF(valor, '')::jsonb, '{}'::jsonb),
    '{incluir_admins}',
    'true'::jsonb
  )
)::text
WHERE chave = 'fallback_destinatarios_atendimento';

-- Se a chave nunca foi criada (instalações novas), semeia com incluir_admins.
INSERT INTO public.configuracoes_ia (chave, valor)
SELECT 'fallback_destinatarios_atendimento',
       '{"setor_id":null,"user_ids":[],"incluir_admins":true}'
WHERE NOT EXISTS (
  SELECT 1 FROM public.configuracoes_ia WHERE chave = 'fallback_destinatarios_atendimento'
);
