UPDATE public.contatos
SET metadata = jsonb_set(
  COALESCE(metadata, '{}'::jsonb),
  '{receitas}',
  '[{
    "label": "digitada pelo cliente",
    "rx_type": "single_vision",
    "eyes": {
      "od": {"sphere": -4.50, "cylinder": null, "axis": null, "add": null},
      "oe": {"sphere": 0.00,  "cylinder": null, "axis": null, "add": null}
    },
    "summary": {"has_addition": false, "needs_progressive": false, "suggested_category": "single_vision"},
    "confidence": 0.99,
    "source": "client_typed_first",
    "needs_human_review": false,
    "raw_correction": "Od -4.50 Oe -pl",
    "data_leitura": "2026-04-28T15:07:00.000Z"
  }]'::jsonb,
  true
)
WHERE id = 'e8e6acba-e2ca-4b63-a579-1158d9ec18df';

UPDATE public.atendimentos
SET modo = 'ia', status = 'aguardando', updated_at = now(), fim_at = NULL
WHERE id = '57a697b5-e0ca-4983-bf6a-0da89b1c4b90';

INSERT INTO public.eventos_crm (contato_id, tipo, descricao, metadata, referencia_tipo, referencia_id)
VALUES (
  'e8e6acba-e2ca-4b63-a579-1158d9ec18df',
  'recuperacao_manual_receita_texto',
  'Receita digitada (Od -4.50 / Oe pl) salva manualmente após escalada indevida — parser não aceitava esf-only/pl. Atendimento devolvido para IA.',
  jsonb_build_object('caso', 'Bianca 28-04', 'ajuste_codigo', 'detectPrescriptionCorrection aceita pl/plano e esf-only + first-typed mode'),
  'atendimento',
  '57a697b5-e0ca-4983-bf6a-0da89b1c4b90'
);