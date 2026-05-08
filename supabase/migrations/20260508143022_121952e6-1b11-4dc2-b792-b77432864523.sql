
-- 1) Tabela de eventos de auditoria do pipeline
CREATE TABLE IF NOT EXISTS public.pipeline_card_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entidade text NOT NULL CHECK (entidade IN ('solicitacao','demanda_loja','contato','agendamento')),
  entidade_id uuid NOT NULL,
  tipo text NOT NULL,
  descricao text,
  coluna_anterior_id uuid,
  coluna_nova_id uuid,
  usuario_id uuid,
  usuario_nome text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_card_eventos_entidade
  ON public.pipeline_card_eventos (entidade, entidade_id, created_at DESC);

ALTER TABLE public.pipeline_card_eventos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read pipeline_card_eventos"
  ON public.pipeline_card_eventos FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated insert pipeline_card_eventos"
  ON public.pipeline_card_eventos FOR INSERT TO authenticated
  WITH CHECK (usuario_id IS NULL OR usuario_id = auth.uid());

CREATE POLICY "Service role full access pipeline_card_eventos"
  ON public.pipeline_card_eventos FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2) Flag de tipo_acao em colunas
ALTER TABLE public.pipeline_colunas
  ADD COLUMN IF NOT EXISTS tipo_acao text;
COMMENT ON COLUMN public.pipeline_colunas.tipo_acao IS
  'Comportamento especial: devolver_para_loja | reentrada_revisao';

-- 3) Trigger: quando a loja responde uma demanda em "aguardando_complemento",
--    move a solicitação vinculada para a coluna de reentrada do mesmo setor.
CREATE OR REPLACE FUNCTION public.trg_demanda_resposta_reentrada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _demanda record;
  _solicitacao_id uuid;
  _setor_id uuid;
  _coluna_reentrada uuid;
  _coluna_atual uuid;
BEGIN
  IF NEW.direcao <> 'loja_para_operador' THEN RETURN NEW; END IF;

  SELECT * INTO _demanda FROM public.demandas_loja WHERE id = NEW.demanda_id;
  IF _demanda IS NULL OR _demanda.status <> 'aguardando_complemento' THEN
    RETURN NEW;
  END IF;

  -- 1) marca demanda como respondida
  UPDATE public.demandas_loja
    SET status = 'respondida',
        ultima_mensagem_loja_at = now(),
        vista_pelo_operador = false
    WHERE id = NEW.demanda_id;

  -- 2) tenta achar solicitação vinculada
  _solicitacao_id := NULLIF(_demanda.metadata->>'solicitacao_id', '')::uuid;
  IF _solicitacao_id IS NULL THEN RETURN NEW; END IF;

  SELECT pipeline_coluna_id INTO _coluna_atual
  FROM public.solicitacoes WHERE id = _solicitacao_id;

  -- 3) descobre o setor pela coluna atual (ou pelo setor_destino_id da demanda)
  IF _coluna_atual IS NOT NULL THEN
    SELECT setor_id INTO _setor_id FROM public.pipeline_colunas WHERE id = _coluna_atual;
  END IF;
  IF _setor_id IS NULL THEN _setor_id := _demanda.setor_destino_id; END IF;
  IF _setor_id IS NULL THEN RETURN NEW; END IF;

  -- 4) busca coluna marcada como reentrada_revisao no setor
  SELECT id INTO _coluna_reentrada
  FROM public.pipeline_colunas
  WHERE setor_id = _setor_id AND tipo_acao = 'reentrada_revisao' AND ativo = true
  ORDER BY ordem ASC LIMIT 1;

  IF _coluna_reentrada IS NULL THEN RETURN NEW; END IF;

  UPDATE public.solicitacoes
    SET pipeline_coluna_id = _coluna_reentrada,
        status = 'em_andamento',
        updated_at = now()
    WHERE id = _solicitacao_id;

  -- 5) evento na timeline
  INSERT INTO public.pipeline_card_eventos
    (entidade, entidade_id, tipo, descricao,
     coluna_anterior_id, coluna_nova_id, usuario_id, usuario_nome, metadata)
  VALUES
    ('solicitacao', _solicitacao_id, 'devolvido_pela_loja',
     'Loja respondeu o complemento — card retornou automaticamente para revisão',
     _coluna_atual, _coluna_reentrada, NEW.autor_id, NEW.autor_nome,
     jsonb_build_object('demanda_id', NEW.demanda_id, 'mensagem_id', NEW.id));

  -- 6) notifica solicitante
  IF _demanda.solicitante_id IS NOT NULL THEN
    INSERT INTO public.notificacoes (usuario_id, tipo, titulo, mensagem, referencia_id)
    VALUES (_demanda.solicitante_id, 'demanda_resposta',
            'Loja completou: ' || COALESCE(_demanda.protocolo, 'demanda'),
            'Card voltou para revisão.',
            _demanda.id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_demanda_resposta_reentrada ON public.demanda_mensagens;
CREATE TRIGGER trg_demanda_resposta_reentrada
AFTER INSERT ON public.demanda_mensagens
FOR EACH ROW EXECUTE FUNCTION public.trg_demanda_resposta_reentrada();
