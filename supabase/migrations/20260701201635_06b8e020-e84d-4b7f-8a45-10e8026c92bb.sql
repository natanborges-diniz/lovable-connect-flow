
ALTER TABLE public.os_recebimento_loja
  ADD COLUMN IF NOT EXISTS whatsapp_message_id text,
  ADD COLUMN IF NOT EXISTS wa_status text,
  ADD COLUMN IF NOT EXISTS wa_status_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_os_recebimento_loja_wamid
  ON public.os_recebimento_loja(whatsapp_message_id);

CREATE OR REPLACE VIEW public.vw_disparos_unificados AS
WITH armacao AS (
  SELECT l.id, 'armacao'::text AS fonte,
         COALESCE(l.template_alias, 'aviso_aguardando_armacao') AS template_nome,
         l.template_alias AS alias,
         c.nome AS cliente_nome,
         COALESCE(l.cliente_telefone, c.telefone) AS telefone,
         l.loja_nome, NULL::uuid AS atendimento_id,
         l.contato_id, l.enviado_at,
         l.status AS wa_status, l.enviado_at AS wa_status_at,
         CASE WHEN l.status='error' THEN COALESCE(l.payload->>'error', l.payload->>'motivo') END AS falha_motivo,
         l.payload AS params,
         l.payload->>'whatsapp_message_id' AS whatsapp_message_id
    FROM public.os_avisos_armacao_log l
    LEFT JOIN public.contatos c ON c.id = l.contato_id
),
entrega AS (
  SELECT r.id, 'entrega'::text AS fonte,
         COALESCE(r.notificado_cliente_template, 'os_recebida_loja') AS template_nome,
         r.notificado_cliente_template AS alias,
         r.cliente_nome, r.cliente_telefone, r.loja_nome,
         NULL::uuid AS atendimento_id, r.contato_id,
         r.notificado_cliente_at AS enviado_at,
         COALESCE(r.wa_status,
                  CASE WHEN r.notificado_cliente_at IS NOT NULL THEN 'sent' END) AS wa_status,
         COALESCE(r.wa_status_at, r.notificado_cliente_at) AS wa_status_at,
         NULL::text AS falha_motivo,
         r.metadata AS params,
         r.whatsapp_message_id
    FROM public.os_recebimento_loja r
   WHERE r.notificado_cliente_at IS NOT NULL
),
pagamento AS (
  SELECT p.id, 'pagamento'::text AS fonte,
         COALESCE(p.metadata->>'template_name','link_pagamento') AS template_nome,
         p.metadata->>'template_alias' AS alias,
         c.nome AS cliente_nome, c.telefone,
         NULL::text AS loja_nome, NULL::uuid AS atendimento_id,
         p.contato_id, p.enviado_at,
         CASE WHEN p.pago_at IS NOT NULL THEN 'read' ELSE 'sent' END AS wa_status,
         COALESCE(p.pago_at, p.enviado_at) AS wa_status_at,
         NULL::text AS falha_motivo, p.metadata AS params,
         p.metadata->>'whatsapp_message_id' AS whatsapp_message_id
    FROM public.pagamentos_link p
    LEFT JOIN public.contatos c ON c.id = p.contato_id
   WHERE p.enviado_at IS NOT NULL
),
mensageria AS (
  SELECT m.id,
         COALESCE(
           CASE
             WHEN COALESCE(m.metadata->>'template_name', substring(m.conteudo from '\[Template:\s*([^\]]+)\]')) ILIKE 'cashback%' THEN 'cashback'
             WHEN COALESCE(m.metadata->>'template_name', substring(m.conteudo from '\[Template:\s*([^\]]+)\]')) ILIKE '%agendamento%'
               OR COALESCE(m.metadata->>'template_name', substring(m.conteudo from '\[Template:\s*([^\]]+)\]')) ILIKE '%lembrete%'
               OR COALESCE(m.metadata->>'template_name', substring(m.conteudo from '\[Template:\s*([^\]]+)\]')) ILIKE '%confirma%' THEN 'agendamento'
             WHEN COALESCE(m.metadata->>'template_name', substring(m.conteudo from '\[Template:\s*([^\]]+)\]')) ILIKE 'retomada%'
               OR COALESCE(m.metadata->>'template_name', substring(m.conteudo from '\[Template:\s*([^\]]+)\]')) ILIKE 'recupera%' THEN 'recuperacao'
             WHEN COALESCE(m.metadata->>'template_name', substring(m.conteudo from '\[Template:\s*([^\]]+)\]')) ILIKE '%os_%'
               OR COALESCE(m.metadata->>'template_name', substring(m.conteudo from '\[Template:\s*([^\]]+)\]')) ILIKE '%retirar%'
               OR COALESCE(m.metadata->>'template_name', substring(m.conteudo from '\[Template:\s*([^\]]+)\]')) ILIKE '%armacao%' THEN 'entrega'
             ELSE 'outro'
           END, 'outro') AS fonte,
         COALESCE(m.metadata->>'template_name', substring(m.conteudo from '\[Template:\s*([^\]]+)\]')) AS template_nome,
         m.metadata->>'template_alias' AS alias,
         c.nome AS cliente_nome, c.telefone,
         NULL::text AS loja_nome, m.atendimento_id, a.contato_id,
         m.created_at AS enviado_at,
         COALESCE(m.metadata->>'last_status','sent') AS wa_status,
         COALESCE((m.metadata->>'last_status_at')::timestamptz, m.created_at) AS wa_status_at,
         m.metadata->>'error_message' AS falha_motivo,
         m.metadata AS params,
         m.metadata->>'whatsapp_message_id' AS whatsapp_message_id
    FROM public.mensagens m
    LEFT JOIN public.atendimentos a ON a.id = m.atendimento_id
    LEFT JOIN public.contatos c ON c.id = a.contato_id
   WHERE m.direcao = 'outbound'::direcao_mensagem
     AND m.deletada_at IS NULL
     AND (m.metadata ? 'template_name' OR m.conteudo LIKE '[Template:%')
)
SELECT * FROM armacao
UNION ALL SELECT * FROM entrega
UNION ALL SELECT * FROM pagamento
UNION ALL SELECT * FROM mensageria;
