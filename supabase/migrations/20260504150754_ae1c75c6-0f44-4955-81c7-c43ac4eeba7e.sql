
INSERT INTO public.whatsapp_templates (nome, categoria, idioma, body, variaveis, status, funcao_alvo)
VALUES (
  'retomada_consultor_v1',
  'UTILITY',
  'pt_BR',
  'Oi {{1}}, aqui é {{2}}, das Óticas Diniz. Desculpa não ter conseguido te responder antes — a falha foi nossa. Posso seguir seu atendimento por aqui agora? É só me mandar um "oi" que já te respondo.',
  '["1","2"]'::jsonb,
  'pending',
  'send-whatsapp (manual via UI quando janela de 24h fecha)'
)
ON CONFLICT (nome) DO UPDATE SET
  categoria = EXCLUDED.categoria,
  body = EXCLUDED.body,
  variaveis = EXCLUDED.variaveis,
  funcao_alvo = EXCLUDED.funcao_alvo;

INSERT INTO public.template_aliases (alias, template_nome)
VALUES ('retomada_consultor', 'retomada_consultor_v1')
ON CONFLICT (alias) DO UPDATE SET template_nome = EXCLUDED.template_nome;
