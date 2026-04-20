-- Expande status permitidos pra cobrir todos os retornados pela Meta
ALTER TABLE public.whatsapp_templates DROP CONSTRAINT IF EXISTS whatsapp_templates_status_check;
ALTER TABLE public.whatsapp_templates ADD CONSTRAINT whatsapp_templates_status_check
  CHECK (status = ANY (ARRAY['rascunho','pending','approved','rejected','paused','disabled']));

-- Reconciliação: importa os 11 templates da Meta para o catálogo local
INSERT INTO public.whatsapp_templates (nome, categoria, idioma, body, variaveis, status, motivo_rejeicao, ultima_sincronizacao, funcao_alvo)
VALUES
  ('confirmacao_agendamento','UTILITY','pt_BR',
   E'✅ Olá {{1}}! Seu agendamento está confirmado.\n\n📍 Loja: {{2}}\n📅 Data: {{3}}\n⏰ Horário: {{4}}\n\nTe esperamos lá! Qualquer dúvida, estamos à disposição.',
   '["1","2","3","4"]'::jsonb,'approved',NULL,now(),'agendamentos-cron'),
  ('lembrete_agendamento','UTILITY','pt_BR',
   E'⏰ Olá {{1}}! Passando para lembrar do seu agendamento amanhã.\n\n📍 Loja: {{2}}\n📅 Data: {{3}}\n⏰ Horário: {{4}}\n\nConfirma sua presença? Responda SIM ou NÃO.',
   '["1","2","3","4"]'::jsonb,'approved',NULL,now(),'agendamentos-cron'),
  ('noshow_reagendamento','MARKETING','pt_BR',
   E'Olá {{1}}! Sentimos sua falta na {{2}} hoje. 😔\n\nSabemos que imprevistos acontecem! Que tal remarcarmos para outro dia?\n\nResponda aqui e a gente agenda rapidinho pra você. 💙',
   '["1","2"]'::jsonb,'approved',NULL,now(),'agendamentos-cron'),
  ('retomada_contexto_1','MARKETING','pt_BR',
   'Oi {{1}}! Estávamos conversando sobre {{2}}. Ficou com alguma dúvida? Estou aqui pra te ajudar 😊',
   '["1","2"]'::jsonb,'approved',NULL,now(),'vendas-recuperacao-cron'),
  ('retomada_contexto_2','MARKETING','pt_BR',
   'Oi {{1}}, tudo bem? Vi que a gente não terminou de conversar sobre {{2}}. Se quiser, posso te enviar mais informações ou agendar uma visita. É só me chamar!',
   '["1","2"]'::jsonb,'approved',NULL,now(),'vendas-recuperacao-cron'),
  ('retomada_despedida','MARKETING','pt_BR',
   'Olá {{1}}, passando aqui uma última vez! Se precisar de algo sobre {{2}} no futuro, é só mandar uma mensagem. Vou estar por aqui! 👋',
   '["1","2"]'::jsonb,'approved',NULL,now(),'vendas-recuperacao-cron'),
  ('diniz_vendas_comvocao','MARKETING','pt_BR',
   E'Olá {{1}}, obrigado por participar da ação das Óticas Diniz no evento COMVOCAÇÃO. \n\nNo resultado do seu exame vimos que você precisará de um novo óculos ou lentes.\nEstou aqui para te auxiliar da melhor forma.\n\nComo você quer que eu te ajude?',
   '["1"]'::jsonb,'approved',NULL,now(),'campanha-comvocao'),
  ('diniz_comvocacao_agradecimento','MARKETING','pt_BR',
   E'Olá {{1}}, obrigado por participar da ação das Óticas Diniz no evento COMVOCAÇÃO. \nNão será necessário utilizar óculos no momento, mas seguimos à disposição para quaisquer informações ou necessidades.',
   '["1"]'::jsonb,'approved',NULL,now(),'campanha-comvocao'),
  ('hello_world','UTILITY','en_US',
   'Welcome and congratulations!! This message demonstrates your ability to send a WhatsApp message notification from the Cloud API, hosted by Meta. Thank you for taking the time to test with us.',
   '[]'::jsonb,'approved',NULL,now(),NULL),
  ('despedida_cordial','MARKETING','pt_BR',
   'Olá {{1}}, vou pausar nosso atendimento por aqui. Quando precisar é só chamar! Equipe Óticas Diniz.',
   '["1"]'::jsonb,'rejected','Rejeitado pela Meta — variável no início/fim',now(),'vendas-recuperacao-cron'),
  ('recuperacao_inatividade_crm','MARKETING','pt_BR',
   'Olá {{1}}, tudo bem? Notamos que paramos nosso bate-papo e queremos saber se ainda podemos te ajudar com seus óculos. Se quiser retomar, é só responder.',
   '["1"]'::jsonb,'rejected','Rejeitado pela Meta',now(),NULL)
ON CONFLICT (nome) DO UPDATE SET
  categoria = EXCLUDED.categoria,
  idioma = EXCLUDED.idioma,
  body = EXCLUDED.body,
  variaveis = EXCLUDED.variaveis,
  status = EXCLUDED.status,
  motivo_rejeicao = EXCLUDED.motivo_rejeicao,
  ultima_sincronizacao = EXCLUDED.ultima_sincronizacao;