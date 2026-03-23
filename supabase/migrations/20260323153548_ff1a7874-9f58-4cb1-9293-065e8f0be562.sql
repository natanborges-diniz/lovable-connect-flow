
-- Criar enum para estágio do funil de vendas
CREATE TYPE public.estagio_funil AS ENUM ('lead', 'qualificado', 'proposta', 'fechado', 'perdido');

-- Adicionar coluna de estágio na tabela contatos
ALTER TABLE public.contatos ADD COLUMN estagio public.estagio_funil NOT NULL DEFAULT 'lead';

-- Adicionar coluna de último contato para fila de prioridade
ALTER TABLE public.contatos ADD COLUMN ultimo_contato_at TIMESTAMP WITH TIME ZONE DEFAULT now();
