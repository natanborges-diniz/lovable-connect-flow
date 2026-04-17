-- Cria colunas iniciais para o setor "Dpto Armações" (mesmo padrão do Atendimento Corporativo)
INSERT INTO public.pipeline_colunas (nome, setor_id, ordem, ativo, cor)
VALUES
  ('Novo', '0e7b7572-4581-4e74-88eb-afca41ab71cf', 0, true, 'muted-foreground'),
  ('Em Atendimento', '0e7b7572-4581-4e74-88eb-afca41ab71cf', 1, true, 'muted-foreground'),
  ('Aguardando Resposta', '0e7b7572-4581-4e74-88eb-afca41ab71cf', 2, true, 'muted-foreground'),
  ('Resolvido', '0e7b7572-4581-4e74-88eb-afca41ab71cf', 3, true, 'muted-foreground')
ON CONFLICT DO NOTHING;