UPDATE public.bot_fluxos
SET etapas = jsonb_build_array(
  jsonb_build_object(
    'campo', 'nome_solicitante',
    'mensagem', '👤 *Nome do solicitante:*',
    'validacao', jsonb_build_object('min_length', 2),
    'tipo_input', 'texto_prefilled',
    'obrigatorio', true
  )
) || etapas
WHERE chave = 'reembolso'
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(etapas) e
    WHERE e->>'campo' = 'nome_solicitante'
  );