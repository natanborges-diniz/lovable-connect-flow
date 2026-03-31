
-- 1. Create bot_fluxos table
CREATE TABLE public.bot_fluxos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chave text UNIQUE NOT NULL,
  nome text NOT NULL,
  tipo_bot text NOT NULL DEFAULT 'loja',
  descricao text,
  etapas jsonb NOT NULL DEFAULT '[]'::jsonb,
  acao_final jsonb NOT NULL DEFAULT '{}'::jsonb,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. RLS
ALTER TABLE public.bot_fluxos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anon can read bot_fluxos" ON public.bot_fluxos FOR SELECT TO anon USING (true);
CREATE POLICY "Authenticated users can manage bot_fluxos" ON public.bot_fluxos FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access bot_fluxos" ON public.bot_fluxos FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3. Add tipo_bot to bot_menu_opcoes
ALTER TABLE public.bot_menu_opcoes ADD COLUMN tipo_bot text NOT NULL DEFAULT 'loja';

-- 4. Seed the 4 existing flows
INSERT INTO public.bot_fluxos (chave, nome, tipo_bot, descricao, etapas, acao_final) VALUES
(
  'link_pagamento',
  'Gerar Link de Pagamento',
  'loja',
  'Gera um link de pagamento via integração com Optical Business',
  '[
    {"campo": "valor", "mensagem": "💳 *Gerar Link de Pagamento*\n\nQual o *valor* do link? (ex: 150.00)", "tipo_input": "decimal", "validacao": {"min": 0.01}, "obrigatorio": true},
    {"campo": "descricao", "mensagem": "📝 Descreva o pagamento (ex: Lente Transition CR39)", "tipo_input": "texto", "validacao": {"min_length": 3}, "obrigatorio": true},
    {"campo": "parcelas", "mensagem": "💳 Máximo de parcelas? (1-12)", "tipo_input": "inteiro", "validacao": {"min": 1, "max": 12}, "obrigatorio": true},
    {"campo": "cliente", "mensagem": "👤 Nome do cliente (ou digite *pular*)", "tipo_input": "texto", "validacao": {}, "obrigatorio": false}
  ]'::jsonb,
  '{"tipo": "criar_solicitacao", "tipo_solicitacao": "link_pagamento", "coluna_destino": "Link Enviado", "endpoint": "payment-links", "template_confirmacao": "✅ *Link gerado com sucesso!*\n\n🔗 {{url}}\n💰 R$ {{valor}}\n📝 {{descricao}}\n💳 Até {{parcelas}}x\n⏰ Válido por 24h"}'::jsonb
),
(
  'gerar_boleto',
  'Gerar Boleto',
  'loja',
  'Solicita a geração de boleto para o setor financeiro',
  '[
    {"campo": "valor", "mensagem": "🧾 *Gerar Boleto*\n\nQual o *valor* do boleto? (ex: 250.00)", "tipo_input": "decimal", "validacao": {"min": 0.01}, "obrigatorio": true},
    {"campo": "cliente", "mensagem": "👤 Nome completo do cliente:", "tipo_input": "texto", "validacao": {"min_length": 3}, "obrigatorio": true},
    {"campo": "documento", "mensagem": "📄 CPF ou CNPJ do cliente (somente números):", "tipo_input": "documento", "validacao": {}, "obrigatorio": true},
    {"campo": "descricao", "mensagem": "📝 Descrição do boleto (ex: Armação Ray-Ban + Lentes):", "tipo_input": "texto", "validacao": {"min_length": 3}, "obrigatorio": true}
  ]'::jsonb,
  '{"tipo": "criar_solicitacao", "tipo_solicitacao": "boleto", "coluna_destino": "Solicitação de Boleto", "template_confirmacao": "✅ *Solicitação de boleto registrada!*\n\n💰 Valor: R$ {{valor}}\n👤 Cliente: {{cliente}}\n📄 CPF/CNPJ: {{documento}}\n📝 {{descricao}}\n\nO setor financeiro irá processar e enviar o boleto."}'::jsonb
),
(
  'consulta_cpf',
  'Consultar CPF',
  'loja',
  'Solicita consulta de CPF para análise de crédito',
  '[
    {"campo": "cpf", "mensagem": "🔍 *Consultar CPF*\n\nDigite o *CPF* para consulta (somente números):", "tipo_input": "cpf", "validacao": {}, "obrigatorio": true},
    {"campo": "nome_cliente", "mensagem": "👤 Nome do cliente:", "tipo_input": "texto", "validacao": {"min_length": 3}, "obrigatorio": true},
    {"campo": "valor_compra", "mensagem": "💰 Qual o *valor total da compra*? (ex: 1500.00)", "tipo_input": "decimal", "validacao": {"min": 0.01}, "obrigatorio": true},
    {"campo": "valor_entrada", "mensagem": "💵 Qual o *valor da entrada*? (ex: 500.00 ou 0 se não houver)", "tipo_input": "decimal", "validacao": {"min": 0}, "obrigatorio": true},
    {"campo": "motivo", "mensagem": "📝 Motivo da consulta (ex: Venda a prazo, Crediário):", "tipo_input": "texto", "validacao": {"min_length": 3}, "obrigatorio": true}
  ]'::jsonb,
  '{"tipo": "criar_solicitacao", "tipo_solicitacao": "consulta_cpf", "coluna_destino": "Consulta CPF", "template_confirmacao": "✅ *Consulta de CPF registrada!*\n\n📄 CPF: {{cpf}}\n👤 Nome: {{nome_cliente}}\n💰 Compra: R$ {{valor_compra}}\n💵 Entrada: R$ {{valor_entrada}}\n🏷️ A financiar: R$ {{valor_financiado}}\n📝 Motivo: {{motivo}}\n\nO setor financeiro irá processar a consulta."}'::jsonb
),
(
  'confirmar_comparecimento',
  'Confirmar Comparecimento de Cliente',
  'loja',
  'Permite à loja confirmar se o cliente agendado compareceu',
  '[]'::jsonb,
  '{"tipo": "fluxo_especial", "fluxo_especial": "confirmar_comparecimento"}'::jsonb
);
