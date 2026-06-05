
-- Tabela de preferências de notificação (gerenciada apenas por admins)
CREATE TABLE IF NOT EXISTS public.notificacao_preferencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tipo text NOT NULL,
  escopo text NOT NULL DEFAULT 'todos' CHECK (escopo IN ('nenhum','meus_setores','setores_especificos','todos')),
  setor_ids uuid[] NOT NULL DEFAULT '{}',
  ativo boolean NOT NULL DEFAULT true,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, tipo)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notificacao_preferencias TO authenticated;
GRANT ALL ON public.notificacao_preferencias TO service_role;

ALTER TABLE public.notificacao_preferencias ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins gerenciam preferencias de notificacao"
  ON public.notificacao_preferencias
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.notif_prefs_set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER trg_notif_prefs_updated
BEFORE UPDATE ON public.notificacao_preferencias
FOR EACH ROW EXECUTE FUNCTION public.notif_prefs_set_updated_at();

-- Função resolver com filtro de preferências + fallback configurável
CREATE OR REPLACE FUNCTION public.resolver_destinatarios_atendimento(_atendimento_id uuid, _tipo text)
RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _atendente uuid;
  _contato_id uuid;
  _setor_id uuid;
  _ids uuid[];
  _fallback_cfg jsonb;
  _fallback_setor uuid;
  _fallback_users uuid[];
  _incluir_admins boolean;
  _filtrados uuid[];
  _uid uuid;
  _pref record;
  _user_setores uuid[];
BEGIN
  SELECT atendente_user_id, contato_id INTO _atendente, _contato_id
  FROM public.atendimentos WHERE id = _atendimento_id;

  -- 1) Atendente explícito
  IF _atendente IS NOT NULL THEN
    _ids := ARRAY[_atendente];
  ELSE
    -- 2) Setor da coluna do contato
    SELECT pc.setor_id INTO _setor_id
    FROM public.contatos c
    LEFT JOIN public.pipeline_colunas pc ON pc.id = c.pipeline_coluna_id
    WHERE c.id = _contato_id;

    IF _setor_id IS NOT NULL THEN
      SELECT array_agg(DISTINCT p.id) INTO _ids
      FROM public.profiles p
      WHERE p.ativo = true
        AND p.tipo_usuario <> 'loja'
        AND (p.setor_id = _setor_id
             OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.setor_id = _setor_id));
    END IF;

    -- 3) Fallback configurável (em vez de "todos admin/colaborador")
    IF _ids IS NULL OR array_length(_ids,1) IS NULL THEN
      SELECT valor INTO _fallback_cfg FROM public.configuracoes_ia WHERE chave = 'fallback_destinatarios_atendimento';
      IF _fallback_cfg IS NOT NULL THEN
        _fallback_setor := NULLIF(_fallback_cfg->>'setor_id','')::uuid;
        _incluir_admins := COALESCE((_fallback_cfg->>'incluir_admins')::boolean, false);
        SELECT array_agg(x::uuid) INTO _fallback_users
          FROM jsonb_array_elements_text(COALESCE(_fallback_cfg->'user_ids','[]'::jsonb)) AS t(x);

        SELECT array_agg(DISTINCT p.id) INTO _ids
        FROM public.profiles p
        WHERE p.ativo = true
          AND (
            (_fallback_setor IS NOT NULL AND (
               p.setor_id = _fallback_setor
               OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.setor_id = _fallback_setor)
            ))
            OR (_fallback_users IS NOT NULL AND p.id = ANY(_fallback_users))
            OR (_incluir_admins AND p.tipo_usuario = 'admin')
          );
      END IF;
    END IF;
  END IF;

  IF _ids IS NULL OR array_length(_ids,1) IS NULL THEN
    RETURN '{}'::uuid[];
  END IF;

  -- Aplicar filtro por preferências (admin configura por usuário)
  _filtrados := ARRAY[]::uuid[];
  FOREACH _uid IN ARRAY _ids LOOP
    SELECT * INTO _pref FROM public.notificacao_preferencias
    WHERE user_id = _uid AND tipo IN (_tipo, '*')
    ORDER BY (tipo = _tipo) DESC
    LIMIT 1;

    IF _pref IS NULL THEN
      _filtrados := _filtrados || _uid;
    ELSIF NOT _pref.ativo THEN
      CONTINUE;
    ELSIF _pref.escopo = 'nenhum' THEN
      CONTINUE;
    ELSIF _pref.escopo = 'todos' THEN
      _filtrados := _filtrados || _uid;
    ELSIF _pref.escopo = 'setores_especificos' THEN
      IF _setor_id IS NOT NULL AND _setor_id = ANY(_pref.setor_ids) THEN
        _filtrados := _filtrados || _uid;
      END IF;
    ELSIF _pref.escopo = 'meus_setores' THEN
      SELECT array_agg(DISTINCT s) INTO _user_setores FROM (
        SELECT setor_id AS s FROM public.user_roles WHERE user_id = _uid AND setor_id IS NOT NULL
        UNION
        SELECT setor_id FROM public.profiles WHERE id = _uid AND setor_id IS NOT NULL
      ) q;
      IF _setor_id IS NOT NULL AND _user_setores IS NOT NULL AND _setor_id = ANY(_user_setores) THEN
        _filtrados := _filtrados || _uid;
      END IF;
    END IF;
  END LOOP;

  RETURN _filtrados;
END;
$$;

-- Overload mantém compat (default = inbound)
CREATE OR REPLACE FUNCTION public.resolver_destinatarios_atendimento(_atendimento_id uuid)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.resolver_destinatarios_atendimento(_atendimento_id, 'atendimento_inbound');
$$;

-- Atualiza triggers para passar o tipo correto
CREATE OR REPLACE FUNCTION public.trg_push_inbound_humano()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _at record;
  _ids uuid[];
  _uid uuid;
  _contato_nome text;
  _preview text;
BEGIN
  IF NEW.direcao::text <> 'inbound' THEN RETURN NEW; END IF;

  SELECT a.id, a.modo, a.status, a.contato_id, a.atendente_user_id
    INTO _at FROM public.atendimentos a WHERE a.id = NEW.atendimento_id;

  IF _at IS NULL OR _at.modo <> 'humano' OR _at.status::text = 'encerrado' THEN
    RETURN NEW;
  END IF;

  _ids := public.resolver_destinatarios_atendimento(_at.id, 'atendimento_inbound');
  IF array_length(_ids, 1) IS NULL THEN RETURN NEW; END IF;

  SELECT nome INTO _contato_nome FROM public.contatos WHERE id = _at.contato_id;
  _preview := left(COALESCE(NEW.conteudo, '[anexo]'), 100);

  FOREACH _uid IN ARRAY _ids LOOP
    INSERT INTO public.notificacoes (usuario_id, tipo, titulo, mensagem, referencia_id)
    VALUES (_uid, 'atendimento_inbound', 'Mensagem de ' || COALESCE(_contato_nome, 'cliente'), _preview, _at.id);
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_push_atendimento_humano()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _ids uuid[];
  _uid uuid;
  _contato_nome text;
  _titulo text;
  _msg text;
BEGIN
  IF NEW.modo <> 'humano' OR OLD.modo = 'humano' THEN RETURN NEW; END IF;
  IF NEW.status = 'encerrado' THEN RETURN NEW; END IF;

  _ids := public.resolver_destinatarios_atendimento(NEW.id, 'atendimento_humano');
  IF array_length(_ids, 1) IS NULL THEN RETURN NEW; END IF;

  SELECT nome INTO _contato_nome FROM public.contatos WHERE id = NEW.contato_id;
  _titulo := 'Atendimento aguardando você';
  _msg := COALESCE(_contato_nome, 'Cliente') || ' precisa de atendimento humano';

  FOREACH _uid IN ARRAY _ids LOOP
    INSERT INTO public.notificacoes (usuario_id, tipo, titulo, mensagem, referencia_id)
    VALUES (_uid, 'atendimento_humano', _titulo, _msg, NEW.id);
  END LOOP;

  RETURN NEW;
END;
$$;
