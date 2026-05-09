-- Limpa receita_confirmacao.pending de contatos cuja última receita salva é inválida
-- (rx_type='unknown' ou ausente) — caso Yuri (Mai/2026)
UPDATE contatos
SET metadata = jsonb_set(
  metadata,
  '{receita_confirmacao}',
  COALESCE(metadata->'receita_confirmacao','{}'::jsonb)
    || jsonb_build_object('pending', false, 'invalidada_at', now()::text)
)
WHERE metadata->'receita_confirmacao'->>'pending' = 'true'
  AND (
    metadata->'receitas' IS NULL
    OR jsonb_typeof(metadata->'receitas') <> 'array'
    OR jsonb_array_length(metadata->'receitas') = 0
    OR COALESCE(metadata->'receitas'->-1->>'rx_type', '') IN ('','unknown')
  );