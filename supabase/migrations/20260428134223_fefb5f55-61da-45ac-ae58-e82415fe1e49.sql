
-- 1. Coluna tipo_usuario em profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS tipo_usuario text NOT NULL DEFAULT 'setor_operador';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_tipo_usuario_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_tipo_usuario_check
  CHECK (tipo_usuario IN ('loja','colaborador','setor_operador','admin'));

-- 2. Backfill com base em user_roles
-- admin -> admin
UPDATE public.profiles p
SET tipo_usuario = 'admin'
WHERE EXISTS (
  SELECT 1 FROM public.user_roles ur
  WHERE ur.user_id = p.id AND ur.role = 'admin'
);

-- quem tem loja_nome em user_roles e não é admin -> loja
UPDATE public.profiles p
SET tipo_usuario = 'loja'
WHERE p.tipo_usuario <> 'admin'
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p.id
      AND ur.loja_nome IS NOT NULL
      AND ur.loja_nome <> ''
  );

-- 3. Função pode_conversar_1a1
CREATE OR REPLACE FUNCTION public.pode_conversar_1a1(_remetente uuid, _destinatario uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH r AS (SELECT tipo_usuario, setor_id FROM public.profiles WHERE id = _remetente),
       d AS (SELECT tipo_usuario, setor_id FROM public.profiles WHERE id = _destinatario)
  SELECT
    -- admin libera tudo
    (SELECT tipo_usuario FROM r) = 'admin'
    OR (SELECT tipo_usuario FROM d) = 'admin'
    -- loja/colaborador <-> loja/colaborador
    OR (
      (SELECT tipo_usuario FROM r) IN ('loja','colaborador')
      AND (SELECT tipo_usuario FROM d) IN ('loja','colaborador')
    )
    -- setor_operador <-> setor_operador, mesmo setor
    OR (
      (SELECT tipo_usuario FROM r) = 'setor_operador'
      AND (SELECT tipo_usuario FROM d) = 'setor_operador'
      AND (SELECT setor_id FROM r) IS NOT NULL
      AND (SELECT setor_id FROM r) = (SELECT setor_id FROM d)
    );
$$;

-- 4. RLS em mensagens_internas — substitui INSERT
DROP POLICY IF EXISTS "Users can send messages" ON public.mensagens_internas;

CREATE POLICY "Users can send 1to1 or system messages"
ON public.mensagens_internas
FOR INSERT
TO authenticated
WITH CHECK (
  remetente_id = auth.uid()
  AND (
    -- conversas-sistema (demanda/ponte) sempre permitidas; backend é fonte de verdade
    conversa_id LIKE 'demanda_%'
    OR conversa_id LIKE 'ponte_%'
    -- 1:1 livre só conforme regra
    OR public.pode_conversar_1a1(auth.uid(), destinatario_id)
  )
);

-- 5. Mapear bot_fluxos.setor_destino_id aos setores reais
-- Financeiro
UPDATE public.bot_fluxos SET setor_destino_id = '7cd0d465-bb9d-4097-a1ae-93106fb82d48'
WHERE chave IN (
  'link_pagamento','gerar_boleto','consulta_cpf',
  'estorno_pix_debito','estorno_cartao','devolucao_os',
  'confirmacao_pix','reembolso','pagamento'
);

-- TI
UPDATE public.bot_fluxos SET setor_destino_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
WHERE chave IN ('suporte_tecnico','impressao','autorizacao_dataweb');

-- Operacional / Loja (confirmação de comparecimento) — fica no setor Loja
UPDATE public.bot_fluxos SET setor_destino_id = '277307f3-747f-4820-95a0-41f11379900a'
WHERE chave IN ('confirmar_comparecimento');

-- Compra de funcionário -> Atendimento Corporativo
UPDATE public.bot_fluxos SET setor_destino_id = '32cbd99c-4b20-4c8b-b7b2-901904d0aff6'
WHERE chave IN ('compra_funcionario');
