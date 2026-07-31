-- ═══════════════════════════════════════════════════════════════════
-- Régua de links/Pix pendentes — dono da cobrança é a LOJA, não o Financeiro.
--
-- Fase 1 (lembrete): cobrança não paga entre 4h e 24h de vida → notifica a
--   loja ("cliente ainda não pagou — reforce"), uma única vez, com comentário
--   na solicitação (visível no Messenger).
-- Fase 2 (expiração): não paga após 24h (ou metadata.expira_em vencido) →
--   encerra automaticamente: status cancelada, coluna Cancelado, arquivada
--   (sai da Mesa do Financeiro), pagamentos_link → expirado, e a loja é
--   avisada de que precisa gerar um novo link se ainda for cobrar.
--
-- Implementação 100% SQL (sem edge function) via pg_cron, de hora em hora.
-- ═══════════════════════════════════════════════════════════════════

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
BEGIN
  SELECT pc.id INTO v_col_cancelado
  FROM pipeline_colunas pc
  JOIN setores s ON s.id = pc.setor_id
  WHERE s.nome = 'Financeiro' AND pc.nome = 'Cancelado' AND pc.ativo
  LIMIT 1;

  -- ── Fase 1: lembrete à loja (4h..24h, uma vez) ──
  FOR r IN
    SELECT * FROM solicitacoes s
    WHERE s.tipo IN ('link_pagamento','pix_pagamento')
      AND s.status NOT IN ('concluida','cancelada')
      AND COALESCE(s.metadata->>'payment_status','') <> 'PAGO'
      AND s.metadata->>'lembrete_loja_at' IS NULL
      AND s.metadata->>'expirado_at' IS NULL
      AND s.created_at < now() - interval '4 hours'
      AND s.created_at > now() - interval '24 hours'
    LIMIT 100
  LOOP
    v_loja := COALESCE(r.metadata->>'alias_loja', r.metadata->>'loja_nome');

    UPDATE solicitacoes
    SET metadata = metadata || jsonb_build_object('lembrete_loja_at', now())
    WHERE id = r.id;

    INSERT INTO solicitacao_comentarios (solicitacao_id, tipo, autor_nome, conteudo, metadata)
    VALUES (
      r.id, 'retorno_setor', 'Sistema Financeiro',
      '⏳ O cliente ainda não concluiu o pagamento desta cobrança. A gestão da cobrança é da loja: reforce com o cliente ou gere uma nova. Ela expira automaticamente 24h após a criação. (aviso automático)',
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

  -- ── Fase 2: expiração automática (>24h ou expira_em vencido) ──
  FOR r IN
    SELECT * FROM solicitacoes s
    WHERE s.tipo IN ('link_pagamento','pix_pagamento')
      AND s.status NOT IN ('concluida','cancelada')
      AND COALESCE(s.metadata->>'payment_status','') <> 'PAGO'
      AND s.metadata->>'expirado_at' IS NULL
      AND COALESCE(
            NULLIF(s.metadata->>'expira_em','')::timestamptz,
            s.created_at + interval '24 hours'
          ) < now()
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
      '⏰ Esta cobrança expirou sem pagamento (validade de 24h) e foi encerrada automaticamente. Se ainda precisar cobrar o cliente, gere um novo link ou Pix. (encerramento automático)',
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

-- Agendamento: de hora em hora, minuto 10
SELECT cron.schedule(
  'regua-links-pendentes',
  '10 * * * *',
  $$ SELECT public.regua_links_pendentes(); $$
);
