-- 1. Coluna de atribuição
ALTER TABLE public.atendimentos
  ADD COLUMN IF NOT EXISTS atendente_user_id uuid;

CREATE INDEX IF NOT EXISTS idx_atendimentos_atendente_user_id
  ON public.atendimentos(atendente_user_id)
  WHERE atendente_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_atendimentos_modo_status
  ON public.atendimentos(modo, status)
  WHERE status <> 'encerrado';

GRANT UPDATE (atendente_user_id, atendente_nome) ON public.atendimentos TO authenticated;

-- 2. Helper: resolve destinatários do atendimento (atendente atribuído ou todos do setor da coluna do contato)
CREATE OR REPLACE FUNCTION public.resolver_destinatarios_atendimento(_atendimento_id uuid)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _atendente uuid;
  _contato_id uuid;
  _setor_id uuid;
  _ids uuid[];
BEGIN
  SELECT atendente_user_id, contato_id INTO _atendente, _contato_id
  FROM public.atendimentos WHERE id = _atendimento_id;

  IF _atendente IS NOT NULL THEN
    RETURN ARRAY[_atendente];
  END IF;

  -- Fallback: todos do setor da coluna atual do contato
  SELECT pc.setor_id INTO _setor_id
  FROM public.contatos c
  LEFT JOIN public.pipeline_colunas pc ON pc.id = c.pipeline_coluna_id
  WHERE c.id = _contato_id;

  IF _setor_id IS NULL THEN
    RETURN '{}'::uuid[];
  END IF;

  SELECT ARRAY_AGG(DISTINCT p.id) INTO _ids
  FROM public.profiles p
  WHERE p.ativo = true
    AND (p.setor_id = _setor_id
         OR EXISTS (SELECT 1 FROM public.user_roles ur
                    WHERE ur.user_id = p.id AND ur.setor_id = _setor_id));
  RETURN COALESCE(_ids, '{}'::uuid[]);
END;
$$;

-- 3. Trigger: atendimento direcionado para humano
CREATE OR REPLACE FUNCTION public.trg_push_atendimento_humano()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ids uuid[];
  _uid uuid;
  _contato_nome text;
  _titulo text;
  _msg text;
BEGIN
  IF NEW.modo <> 'humano' OR OLD.modo = 'humano' THEN
    RETURN NEW;
  END IF;
  IF NEW.status = 'encerrado' THEN
    RETURN NEW;
  END IF;

  _ids := public.resolver_destinatarios_atendimento(NEW.id);
  IF array_length(_ids, 1) IS NULL THEN
    RETURN NEW;
  END IF;

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

DROP TRIGGER IF EXISTS trg_atendimento_modo_humano ON public.atendimentos;
CREATE TRIGGER trg_atendimento_modo_humano
AFTER UPDATE OF modo ON public.atendimentos
FOR EACH ROW EXECUTE FUNCTION public.trg_push_atendimento_humano();

-- 4. Trigger: nova mensagem inbound em atendimento humano
CREATE OR REPLACE FUNCTION public.trg_push_inbound_humano()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _at record;
  _ids uuid[];
  _uid uuid;
  _contato_nome text;
  _preview text;
BEGIN
  IF NEW.direcao::text <> 'inbound' THEN RETURN NEW; END IF;

  SELECT a.id, a.modo, a.status, a.contato_id, a.atendente_user_id
    INTO _at
  FROM public.atendimentos a
  WHERE a.id = NEW.atendimento_id;

  IF _at IS NULL OR _at.modo <> 'humano' OR _at.status::text = 'encerrado' THEN
    RETURN NEW;
  END IF;

  _ids := public.resolver_destinatarios_atendimento(_at.id);
  IF array_length(_ids, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT nome INTO _contato_nome FROM public.contatos WHERE id = _at.contato_id;
  _preview := left(COALESCE(NEW.conteudo, '[anexo]'), 100);

  FOREACH _uid IN ARRAY _ids LOOP
    INSERT INTO public.notificacoes (usuario_id, tipo, titulo, mensagem, referencia_id)
    VALUES (_uid, 'atendimento_inbound', 'Mensagem de ' || COALESCE(_contato_nome, 'cliente'), _preview, _at.id);
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mensagem_inbound_humano ON public.mensagens;
CREATE TRIGGER trg_mensagem_inbound_humano
AFTER INSERT ON public.mensagens
FOR EACH ROW EXECUTE FUNCTION public.trg_push_inbound_humano();

-- 5. Ajustar fn_send_push para customizar URL/tag por tipo via trigger trg_push_nova_notificacao
-- (mantém comportamento; URLs e tags já são tratadas no trigger existente)

-- 6. Atualiza trg_push_nova_notificacao para usar URL e tag específicas de atendimento
CREATE OR REPLACE FUNCTION public.trg_push_nova_notificacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  _ids uuid[];
  _url text := '/notificacoes';
  _tag text := 'notif_' || new.id::text;
begin
  if new.usuario_id is not null then
    _ids := array[new.usuario_id];
  elsif new.setor_id is not null then
    select array_agg(id) into _ids
    from public.profiles
    where setor_id = new.setor_id and ativo = true;
  end if;

  if _ids is null or array_length(_ids,1) is null then
    return new;
  end if;

  -- URL e tag específicas por tipo
  if new.tipo in ('atendimento_humano', 'atendimento_inbound') and new.referencia_id is not null then
    _url := '/atendimentos?atendimento=' || new.referencia_id::text;
    _tag := 'at_' || new.referencia_id::text;  -- colapsa por atendimento
  end if;

  perform public.fn_send_push(
    _ids,
    coalesce(new.titulo, 'Notificação'),
    left(coalesce(new.mensagem, ''), 120),
    _url,
    _tag
  );
  return new;
end;
$$;