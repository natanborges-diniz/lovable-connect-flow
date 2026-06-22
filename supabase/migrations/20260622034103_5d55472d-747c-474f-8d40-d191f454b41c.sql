
-- Tabela única que rastreia ambos fluxos de aviso de OS:
--  1) cron 07:00 SP → cliente avisado de codEtapa=15 (aguardando armação)
--  2) loja confirma manualmente recebimento → cliente avisado de "óculos pronto na loja"
CREATE TABLE public.os_recebimento_loja (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  os_numero text NOT NULL,
  loja_nome text NOT NULL,
  cod_empresa text,
  contato_id uuid REFERENCES public.contatos(id) ON DELETE SET NULL,
  cliente_nome text,
  cliente_telefone text,
  produto_descricao text,
  cod_etapa_atual int,
  etapa_label text,
  data_movimentacao date,
  -- Fluxo 1: aviso D+1 de aguardando armação
  aviso_armacao_enviado_at timestamptz,
  aviso_armacao_template text,
  -- Fluxo 2: recebimento manual pela loja
  recebido_at timestamptz,
  recebido_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notificado_cliente_at timestamptz,
  notificado_cliente_template text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (os_numero, loja_nome)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.os_recebimento_loja TO authenticated;
GRANT ALL ON public.os_recebimento_loja TO service_role;

ALTER TABLE public.os_recebimento_loja ENABLE ROW LEVEL SECURITY;

-- Admin / operador vê tudo
CREATE POLICY "admin_op_full_os_recebimento"
  ON public.os_recebimento_loja FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operador'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operador'));

-- Usuário de loja vê e atualiza apenas registros da(s) sua(s) loja(s)
CREATE POLICY "loja_select_own_os_recebimento"
  ON public.os_recebimento_loja FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_acessos ua
      WHERE ua.user_id = auth.uid()
        AND (ua.acesso_total = true OR loja_nome = ANY(COALESCE(ua.lojas, '{}'::text[])))
    )
  );

CREATE POLICY "loja_update_own_os_recebimento"
  ON public.os_recebimento_loja FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_acessos ua
      WHERE ua.user_id = auth.uid()
        AND (ua.acesso_total = true OR loja_nome = ANY(COALESCE(ua.lojas, '{}'::text[])))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_acessos ua
      WHERE ua.user_id = auth.uid()
        AND (ua.acesso_total = true OR loja_nome = ANY(COALESCE(ua.lojas, '{}'::text[])))
    )
  );

CREATE INDEX idx_os_recebimento_loja_loja ON public.os_recebimento_loja(loja_nome) WHERE recebido_at IS NULL;
CREATE INDEX idx_os_recebimento_loja_contato ON public.os_recebimento_loja(contato_id);

CREATE TRIGGER trg_os_recebimento_loja_updated_at
  BEFORE UPDATE ON public.os_recebimento_loja
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Templates UTILITY (rascunho — Meta precisa aprovar antes do envio efetivo)
INSERT INTO public.whatsapp_templates (nome, categoria, idioma, body, variaveis, status, funcao_alvo)
VALUES
  (
    'os_recebida_loja',
    'UTILITY',
    'pt_BR',
    'Oi {{1}}! Seu pedido {{2}} já chegou na nossa loja {{3}}. Estamos finalizando os detalhes e em breve te avisamos quando estiver pronto para retirada. — Óticas Diniz',
    '["nome","os_numero","loja"]'::jsonb,
    'rascunho',
    'confirmar-recebimento-os'
  ),
  (
    'aviso_aguardando_armacao',
    'UTILITY',
    'pt_BR',
    'Oi {{1}}! Suas lentes do pedido {{2}} já estão prontas e só falta a armação para finalizarmos. Passe na nossa loja {{3}} no horário que for melhor pra você. — Óticas Diniz',
    '["nome","os_numero","loja"]'::jsonb,
    'rascunho',
    'regua-disparo-aguardando-armacao'
  )
ON CONFLICT (nome) DO NOTHING;

-- Aliases lógicos (apontam para a versão atual; UI pode repointar)
INSERT INTO public.template_aliases (alias, template_nome, descricao)
VALUES
  ('os_recebida_loja',        'os_recebida_loja',        'Aviso ao cliente quando a loja confirma recebimento da OS no Atrium'),
  ('aviso_aguardando_armacao','aviso_aguardando_armacao','Aviso D+1 ao cliente quando OS entrou em codEtapa=15 — pedir armação')
ON CONFLICT (alias) DO NOTHING;
