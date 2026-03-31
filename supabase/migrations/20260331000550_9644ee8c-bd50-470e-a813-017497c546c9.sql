-- Update the test solicitação (link de pagamento de R$ 1.00 já pago) to "Pago" column and add TID info
UPDATE solicitacoes 
SET 
  pipeline_coluna_id = '21227ace-d9b9-4cb9-b096-99dd4c8b10cd',
  status = 'concluida',
  metadata = jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          COALESCE(metadata, '{}'::jsonb),
          '{payment_status}', '"PAGO"'
        ),
        '{payment_confirmed_at}', to_jsonb(now()::text)
      ),
      '{tid}', '"teste-pendente-verificar-no-ob"'
    ),
    '{authorization}', '"teste-pendente-verificar-no-ob"'
  )
WHERE id = 'cb030906-a0a9-408f-8186-5c776a5e6332';

-- Log CRM event
INSERT INTO eventos_crm (contato_id, tipo, descricao, referencia_tipo, referencia_id, metadata)
SELECT 
  contato_id,
  'pagamento_confirmado',
  'Pagamento confirmado via link (atualização manual de teste). Valor: R$ 1.00',
  'solicitacao',
  id,
  '{"payment_link_id": "dcf00676-b83a-4280-9a37-0586eb64f183", "status": "PAGO", "manual": true}'::jsonb
FROM solicitacoes 
WHERE id = 'cb030906-a0a9-408f-8186-5c776a5e6332';