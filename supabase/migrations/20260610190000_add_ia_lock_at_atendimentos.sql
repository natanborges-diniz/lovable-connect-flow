-- Coluna dedicada para o lock atômico do ai-triage.
-- Substitui o campo ia_lock no JSONB metadata, que não permite CAS verdadeiro.
-- O UPDATE com WHERE id=$1 AND (ia_lock_at IS NULL OR ia_lock_at < now()-30s)
-- é serializado pelo Postgres — só uma execução concorrente ganha o lock.

ALTER TABLE public.atendimentos
  ADD COLUMN IF NOT EXISTS ia_lock_at timestamptz;
