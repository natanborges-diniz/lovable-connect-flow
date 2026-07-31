CREATE OR REPLACE FUNCTION public.regua_links_pendentes()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  d record;
  v_col_cancelado uuid;
  v_lembretes int := 0;
  v_expirados int := 0;
  v_loja text;
  v_horas_lembrete constant int := 4;
  v_horas_expira  constant int := 48;
BEGIN
  SELECT pc.id INTO v_col_cancelado
  FROM pipeline_colunas pc
  JOIN setores s ON s.id = pc.setor_id
  WHERE s.nome = 'Financeiro' AND pc.nome = 'Cancelado' AND pc.ativo
  LIMIT 1;

  FOR r IN
    SELECT * FROM solicitacoes s
    WHERE s.tipo IN ('link_pagamento','pix_pagamento')
      AND s.status NOT IN ('concluida','cancelada')
      AND COALESCE(s.metadata->>'payment_status','') <> 'PAGO'
      AND s.metadata->>'lembrete_loja_at' IS NULL
      AND s.metadata->>'expirado_at' IS NULL
      AND s.created_at < now() - make_interval(hours => v_horas_lembrete)
      AND s.created_at > now() - make_interval(hours => v_horas_expira)
    LIMIT 100
  LOOP
    v_loja := COALESCE(r.metadata->>'alias_loja', r.metadata->>'loja_nome');

    UPDATE solicitacoes
    SET metadata = metadata || jsonb_build_object('lembrete_loja_at', now())
    WHERE id = r.id;

    INSERT INTO solicitacao_comentarios (solicitacao_id, tipo, autor_nome, conteudo, metadata)
    VALUES (
      r.id, 'retorno_setor', 'Sistema Financeiro',
      '⏳ O cliente ainda não concluiu o pagamento desta cobrança. A gestão da cobrança é da loja: reforce com o cliente ou gere uma nova. Ela expira automaticamente 48h após a criação (o link em si pode ter validade menor — na dúvida, gere um novo). (aviso automático)',
      jsonb_build_object('origem','regua_links_pendentes','fase','lembrete')
    );

    IF v_loja IS NOT NULL THEN
      FOR d IN SELECT * FROM resolver_destinatarios_loja(v_loja) LOOP
        INSERT INTO notificacoes (usuario_id, setor_id, titulo, mensagem, tipo, referencia_id)
        VALUES (
          d.user_id, d.setor_id,
          '⏳ Pagamento pendente — ' || COALESCE(r.metadata->>'cliente','cliente'),
          COALESCE(r.protocolo,'Cobrança') || ' sem pagamento há mais de 4h. Reforce com o cliente ou gere uma nova cobrança.',
          'solicitacao', r.id
        );
      END LOOP;
    END IF;

    v_lembretes := v_lembretes + 1;
  END LOOP;

  FOR r IN
    SELECT * FROM solicitacoes s
    WHERE s.tipo IN ('link_pagamento','pix_pagamento')
      AND s.status NOT IN ('concluida','cancelada')
      AND COALESCE(s.metadata->>'payment_status','') <> 'PAGO'
      AND s.metadata->>'expirado_at' IS NULL
      AND s.created_at < now() - make_interval(hours => v_horas_expira)
    LIMIT 100
  LOOP
    v_loja := COALESCE(r.metadata->>'alias_loja', r.metadata->>'loja_nome');

    UPDATE solicitacoes
    SET status = 'cancelada',
        pipeline_coluna_id = COALESCE(v_col_cancelado, pipeline_coluna_id),
        metadata = metadata || jsonb_build_object(
          'expirado_at', now(),
          'arquivado_at', now(),
          'expirado_por', 'regua_links_pendentes'
        )
    WHERE id = r.id;

    UPDATE pagamentos_link
    SET status = 'expirado', expirado_at = now()
    WHERE solicitacao_id = r.id AND status NOT IN ('pago','estornado');

    INSERT INTO solicitacao_comentarios (solicitacao_id, tipo, autor_nome, conteudo, metadata)
    VALUES (
      r.id, 'retorno_setor', 'Sistema Financeiro',
      '⏰ Esta cobrança expirou sem pagamento (prazo de 48h) e foi encerrada automaticamente. Se ainda precisar cobrar o cliente, gere um novo link ou Pix. (encerramento automático)',
      jsonb_build_object('origem','regua_links_pendentes','fase','expiracao')
    );

    IF v_loja IS NOT NULL THEN
      FOR d IN SELECT * FROM resolver_destinatarios_loja(v_loja) LOOP
        INSERT INTO notificacoes (usuario_id, setor_id, titulo, mensagem, tipo, referencia_id)
        VALUES (
          d.user_id, d.setor_id,
          '⏰ Cobrança expirada — ' || COALESCE(r.metadata->>'cliente','cliente'),
          COALESCE(r.protocolo,'Cobrança') || ' expirou sem pagamento e foi encerrada. Gere uma nova se necessário.',
          'solicitacao', r.id
        );
      END LOOP;
    END IF;

    v_expirados := v_expirados + 1;
  END LOOP;

  RETURN jsonb_build_object('lembretes', v_lembretes, 'expirados', v_expirados);
END;
$$;

SELECT cron.schedule(
  'regua-links-pendentes',
  '10 * * * *',
  $$ SELECT public.regua_links_pendentes(); $$
);

-- ════════ 20260731230000_regua_cliente_24h.sql ════════

INSERT INTO public.template_aliases (alias, template_nome, descricao)
VALUES (
  'cobranca_lembrete_cliente',
  'cobranca_lembrete_cliente_v1',
  'Lembrete ao cliente 24h antes da cobrança expirar: {{1}} protocolo, {{2}} valor, {{3}} link da página'
)
ON CONFLICT (alias) DO NOTHING;

CREATE OR REPLACE FUNCTION public.regua_links_pendentes()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  d record;
  v_col_cancelado uuid;
  v_lembretes int := 0;
  v_lembretes_cliente int := 0;
  v_expirados int := 0;
  v_loja text;
  v_contato_cliente uuid;
  v_url text;
  v_valor text;
  v_horas_lembrete constant int := 4;
  v_horas_cliente  constant int := 24;
  v_horas_expira   constant int := 48;
BEGIN
  SELECT pc.id INTO v_col_cancelado
  FROM pipeline_colunas pc
  JOIN setores s ON s.id = pc.setor_id
  WHERE s.nome = 'Financeiro' AND pc.nome = 'Cancelado' AND pc.ativo
  LIMIT 1;

  FOR r IN
    SELECT * FROM solicitacoes s
    WHERE s.tipo IN ('link_pagamento','pix_pagamento')
      AND s.status NOT IN ('concluida','cancelada')
      AND COALESCE(s.metadata->>'payment_status','') <> 'PAGO'
      AND s.metadata->>'lembrete_loja_at' IS NULL
      AND s.metadata->>'expirado_at' IS NULL
      AND s.created_at < now() - make_interval(hours => v_horas_lembrete)
      AND s.created_at > now() - make_interval(hours => v_horas_expira)
    LIMIT 100
  LOOP
    v_loja := COALESCE(r.metadata->>'alias_loja', r.metadata->>'loja_nome');

    UPDATE solicitacoes
    SET metadata = metadata || jsonb_build_object('lembrete_loja_at', now())
    WHERE id = r.id;

    INSERT INTO solicitacao_comentarios (solicitacao_id, tipo, autor_nome, conteudo, metadata)
    VALUES (
      r.id, 'retorno_setor', 'Sistema Financeiro',
      '⏳ O cliente ainda não concluiu o pagamento desta cobrança. A gestão da cobrança é da loja: reforce com o cliente ou gere uma nova. Às 24h o cliente recebe um lembrete automático no WhatsApp; às 48h a cobrança expira e ele pode renovar sozinho pela página. (aviso automático)',
      jsonb_build_object('origem','regua_links_pendentes','fase','lembrete')
    );

    IF v_loja IS NOT NULL THEN
      FOR d IN SELECT * FROM resolver_destinatarios_loja(v_loja) LOOP
        INSERT INTO notificacoes (usuario_id, setor_id, titulo, mensagem, tipo, referencia_id)
        VALUES (
          d.user_id, d.setor_id,
          '⏳ Pagamento pendente — ' || COALESCE(r.metadata->>'cliente','cliente'),
          COALESCE(r.protocolo,'Cobrança') || ' sem pagamento há mais de 4h. Reforce com o cliente ou gere uma nova cobrança.',
          'solicitacao', r.id
        );
      END LOOP;
    END IF;

    v_lembretes := v_lembretes + 1;
  END LOOP;

  FOR r IN
    SELECT * FROM solicitacoes s
    WHERE s.tipo IN ('link_pagamento','pix_pagamento')
      AND s.status NOT IN ('concluida','cancelada')
      AND COALESCE(s.metadata->>'payment_status','') <> 'PAGO'
      AND s.metadata->>'lembrete_cliente_at' IS NULL
      AND s.metadata->>'expirado_at' IS NULL
      AND s.created_at < now() - make_interval(hours => v_horas_cliente)
      AND s.created_at > now() - make_interval(hours => v_horas_expira)
    LIMIT 50
  LOOP
    SELECT pl.contato_id, COALESCE(pl.link_url, r.metadata->>'url')
      INTO v_contato_cliente, v_url
    FROM pagamentos_link pl
    WHERE pl.solicitacao_id = r.id
    LIMIT 1;

    UPDATE solicitacoes
    SET metadata = metadata || jsonb_build_object('lembrete_cliente_at', now())
    WHERE id = r.id;

    IF v_contato_cliente IS NOT NULL AND v_url IS NOT NULL THEN
      v_valor := replace(COALESCE(r.metadata->>'valor','0'), '.', ',');
      PERFORM net.http_post(
        url := 'https://kvggebtnqmxydtwaumqz.supabase.co/functions/v1/send-whatsapp-template',
        headers := '{"Content-Type":"application/json","Authorization":"Bearer sb_publishable_z2ntN4TlU5CAevIAoxR0OA_WqWRukuZ"}'::jsonb,
        body := jsonb_build_object(
          'contato_id', v_contato_cliente,
          'template_alias', 'cobranca_lembrete_cliente',
          'template_params', jsonb_build_array(
            COALESCE(r.protocolo, 'Cobrança'),
            v_valor,
            v_url
          ),
          'language', 'pt_BR'
        )
      );
      v_lembretes_cliente := v_lembretes_cliente + 1;
    END IF;
  END LOOP;

  FOR r IN
    SELECT * FROM solicitacoes s
    WHERE s.tipo IN ('link_pagamento','pix_pagamento')
      AND s.status NOT IN ('concluida','cancelada')
      AND COALESCE(s.metadata->>'payment_status','') <> 'PAGO'
      AND s.metadata->>'expirado_at' IS NULL
      AND s.created_at < now() - make_interval(hours => v_horas_expira)
    LIMIT 100
  LOOP
    v_loja := COALESCE(r.metadata->>'alias_loja', r.metadata->>'loja_nome');

    UPDATE solicitacoes
    SET status = 'cancelada',
        pipeline_coluna_id = COALESCE(v_col_cancelado, pipeline_coluna_id),
        metadata = metadata || jsonb_build_object(
          'expirado_at', now(),
          'arquivado_at', now(),
          'expirado_por', 'regua_links_pendentes'
        )
    WHERE id = r.id;

    UPDATE pagamentos_link
    SET status = 'expirado', expirado_at = now()
    WHERE solicitacao_id = r.id AND status NOT IN ('pago','estornado');

    INSERT INTO solicitacao_comentarios (solicitacao_id, tipo, autor_nome, conteudo, metadata)
    VALUES (
      r.id, 'retorno_setor', 'Sistema Financeiro',
      '⏰ Esta cobrança expirou sem pagamento (prazo de 48h) e foi encerrada automaticamente. O cliente pode gerar um novo link sozinho pela própria página da cobrança; a loja também pode gerar um novo quando quiser. (encerramento automático)',
      jsonb_build_object('origem','regua_links_pendentes','fase','expiracao')
    );

    IF v_loja IS NOT NULL THEN
      FOR d IN SELECT * FROM resolver_destinatarios_loja(v_loja) LOOP
        INSERT INTO notificacoes (usuario_id, setor_id, titulo, mensagem, tipo, referencia_id)
        VALUES (
          d.user_id, d.setor_id,
          '⏰ Cobrança expirada — ' || COALESCE(r.metadata->>'cliente','cliente'),
          COALESCE(r.protocolo,'Cobrança') || ' expirou sem pagamento e foi encerrada. O cliente pode renovar sozinho pela página; acompanhe.',
          'solicitacao', r.id
        );
      END LOOP;
    END IF;

    v_expirados := v_expirados + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'lembretes_loja', v_lembretes,
    'lembretes_cliente', v_lembretes_cliente,
    'expirados', v_expirados
  );
END;
$$;