UPDATE contatos SET metadata = jsonb_set(
  jsonb_set(metadata, '{receita_confirmacao}', '{"pending": false, "confirmed_at": "2026-05-07T15:50:51.680Z", "rx_label": "cliente"}'::jsonb),
  '{receitas}',
  (SELECT jsonb_agg(CASE WHEN (r->>'confirmed_by_client_at') IS NULL THEN jsonb_set(r, '{confirmed_by_client_at}', '"2026-05-07T15:50:51.680Z"') ELSE r END) FROM jsonb_array_elements(metadata->'receitas') r)
) WHERE id='d45da27f-24d8-43ac-bcf4-d39ea2f1ca7d';