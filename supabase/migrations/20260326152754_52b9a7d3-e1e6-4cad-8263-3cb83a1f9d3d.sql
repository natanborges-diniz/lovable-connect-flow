UPDATE pipeline_automacoes 
SET config = jsonb_set(
  config, 
  '{template_params}', 
  '["{{primeiro_nome}}", "{{loja}}", "{{data}}", "{{hora}}"]'::jsonb
)
WHERE status_alvo = 'lembrete_enviado' 
  AND tipo_acao = 'enviar_template'
  AND entidade = 'agendamento';