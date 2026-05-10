
-- Tabelas para Auditoria IA Sob Demanda

CREATE TABLE IF NOT EXISTS public.ia_auditorias_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  iniciado_por uuid,
  janela_inicio timestamptz NOT NULL,
  janela_fim timestamptz NOT NULL,
  severidade_minima text NOT NULL DEFAULT 'warn',
  amostra_limpos_pct integer NOT NULL DEFAULT 10,
  total_atendimentos integer NOT NULL DEFAULT 0,
  total_flagged integer NOT NULL DEFAULT 0,
  total_avaliados_llm integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'rodando', -- rodando|concluido|erro
  erro text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  finalizado_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.ia_auditorias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.ia_auditorias_runs(id) ON DELETE CASCADE,
  atendimento_id uuid,
  contato_id uuid,
  contato_nome text,
  contato_telefone text,
  score_global numeric, -- 0-10
  severidade text NOT NULL DEFAULT 'ok', -- ok|info|warn|critical
  categorias jsonb NOT NULL DEFAULT '{}'::jsonb, -- {compreensao, tom, info, tool, fechamento}
  problemas jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{tipo, severidade, trecho, motivo}]
  diagnostico text,
  flags_heuristicos jsonb NOT NULL DEFAULT '[]'::jsonb,
  transcricao_resumo text,
  fonte text NOT NULL DEFAULT 'llm', -- heuristica|llm|amostra
  status text NOT NULL DEFAULT 'pendente', -- pendente|aplicado|ignorado
  ignorado_motivo text,
  ignorado_por uuid,
  ignorado_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ia_auditorias_run ON public.ia_auditorias(run_id);
CREATE INDEX IF NOT EXISTS idx_ia_auditorias_severidade ON public.ia_auditorias(severidade);
CREATE INDEX IF NOT EXISTS idx_ia_auditorias_status ON public.ia_auditorias(status);

CREATE TABLE IF NOT EXISTS public.ia_auditorias_acoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auditoria_id uuid NOT NULL REFERENCES public.ia_auditorias(id) ON DELETE CASCADE,
  tipo text NOT NULL, -- regra_proibida|exemplo|ajuste_prompt|tarefa_ti
  alvo_tabela text NOT NULL,
  alvo_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  desfeita boolean NOT NULL DEFAULT false,
  desfeita_at timestamptz,
  desfeita_por uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ia_auditorias_acoes_auditoria ON public.ia_auditorias_acoes(auditoria_id);

CREATE TABLE IF NOT EXISTS public.ia_instrucoes_prompt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria text NOT NULL DEFAULT 'fluxo', -- fluxo|tom|seguranca|fechamento|geral
  instrucao text NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  origem text NOT NULL DEFAULT 'auditoria',
  origem_ref uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ia_instrucoes_prompt_ativo ON public.ia_instrucoes_prompt(ativo);

-- RLS
ALTER TABLE public.ia_auditorias_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ia_auditorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ia_auditorias_acoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ia_instrucoes_prompt ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read ia_auditorias_runs" ON public.ia_auditorias_runs
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role full ia_auditorias_runs" ON public.ia_auditorias_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated read ia_auditorias" ON public.ia_auditorias
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role full ia_auditorias" ON public.ia_auditorias
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated read ia_auditorias_acoes" ON public.ia_auditorias_acoes
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role full ia_auditorias_acoes" ON public.ia_auditorias_acoes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated manage ia_instrucoes_prompt" ON public.ia_instrucoes_prompt
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Service role full ia_instrucoes_prompt" ON public.ia_instrucoes_prompt
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Trigger updated_at
CREATE TRIGGER trg_ia_auditorias_updated_at
  BEFORE UPDATE ON public.ia_auditorias
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_ia_instrucoes_prompt_updated_at
  BEFORE UPDATE ON public.ia_instrucoes_prompt
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
