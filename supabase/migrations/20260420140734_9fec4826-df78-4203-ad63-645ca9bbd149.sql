CREATE TABLE public.whatsapp_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text UNIQUE NOT NULL,
  categoria text NOT NULL CHECK (categoria IN ('UTILITY','MARKETING','AUTHENTICATION')),
  idioma text NOT NULL DEFAULT 'pt_BR',
  body text NOT NULL,
  variaveis jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','pending','approved','rejected')),
  motivo_rejeicao text,
  funcao_alvo text,
  ultima_sincronizacao timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view whatsapp_templates"
ON public.whatsapp_templates FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can insert whatsapp_templates"
ON public.whatsapp_templates FOR INSERT TO authenticated
WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins can update whatsapp_templates"
ON public.whatsapp_templates FOR UPDATE TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins can delete whatsapp_templates"
ON public.whatsapp_templates FOR DELETE TO authenticated
USING (public.is_admin(auth.uid()));

CREATE POLICY "Service role full access whatsapp_templates"
ON public.whatsapp_templates FOR ALL TO service_role
USING (true) WITH CHECK (true);

CREATE TRIGGER update_whatsapp_templates_updated_at
BEFORE UPDATE ON public.whatsapp_templates
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.whatsapp_templates (nome, categoria, idioma, body, variaveis, funcao_alvo) VALUES
('lembrete_agendamento_24h','UTILITY','pt_BR',
 'Olá {{1}}! Lembrete: você tem horário marcado em {{2}} no dia {{3}} às {{4}}. Posso confirmar sua presença?',
 '["nome_cliente","loja","data","hora"]'::jsonb,'agendamentos-cron'),
('confirmacao_agendamento','UTILITY','pt_BR',
 'Oi {{1}}! Seu horário em {{2}} foi agendado para {{3}} às {{4}}. Endereço: {{5}}.',
 '["nome_cliente","loja","data","hora","endereco"]'::jsonb,'agendamentos-cron'),
('noshow_recuperacao_loja','UTILITY','pt_BR',
 'Cliente {{1}} (agend. {{2}}) não compareceu até agora. Pode confirmar status com a loja {{3}}?',
 '["nome_cliente","horario","loja"]'::jsonb,'agendamentos-cron'),
('comprovante_pagamento_loja','UTILITY','pt_BR',
 'Pagamento confirmado! Cliente: {{1}} | Valor: R$ {{2}} | NSU: {{3}} | Loja: {{4}}',
 '["cliente","valor","nsu","loja"]'::jsonb,'payment-webhook'),
('demanda_loja_nova','UTILITY','pt_BR',
 'Nova demanda {{1}} para loja {{2}}: {{3}}. Responda esta mensagem para tratar.',
 '["protocolo","loja","pergunta"]'::jsonb,'criar-demanda-loja'),
('demanda_loja_encerrada','UTILITY','pt_BR',
 'Demanda {{1}} encerrada. Resumo: {{2}}',
 '["protocolo","resumo"]'::jsonb,'encerrar-demanda-loja'),
('retomada_contexto_lead','MARKETING','pt_BR',
 'Oi {{1}}! Tudo bem? Notei que conversamos sobre {{2}} e não fechamos ainda. Posso te ajudar com mais alguma informação?',
 '["nome_cliente","contexto"]'::jsonb,'vendas-recuperacao-cron'),
('retomada_pos_orcamento','MARKETING','pt_BR',
 'Olá {{1}}! Sobre o orçamento de {{2}} que enviamos: alguma dúvida? Posso reservar horário para você conhecer presencialmente.',
 '["nome_cliente","produto"]'::jsonb,'vendas-recuperacao-cron'),
('despedida_cordial','MARKETING','pt_BR',
 '{{1}}, vou pausar nosso atendimento por aqui. Quando precisar é só chamar! Equipe Atrium.',
 '["nome_cliente"]'::jsonb,'vendas-recuperacao-cron');