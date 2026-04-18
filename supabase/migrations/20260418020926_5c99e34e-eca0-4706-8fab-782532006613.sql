-- Cleanup: merge contato duplicado "Franciana" (criado errado como cliente) com "Loja Teste" real
DO $$
DECLARE
  _bad_id uuid := 'eb8c5066-bd60-484e-8c26-3825c654df03';
  _good_id uuid := '90ddecb2-0e9d-41e7-9391-ca55561d8110';
BEGIN
  IF EXISTS (SELECT 1 FROM public.contatos WHERE id = _bad_id) THEN
    UPDATE public.atendimentos SET contato_id = _good_id WHERE contato_id = _bad_id;
    UPDATE public.solicitacoes SET contato_id = _good_id WHERE contato_id = _bad_id;
    UPDATE public.eventos_crm SET contato_id = _good_id WHERE contato_id = _bad_id;
    UPDATE public.canais SET contato_id = _good_id WHERE contato_id = _bad_id;
    DELETE FROM public.contatos WHERE id = _bad_id;
  END IF;

  -- Garante que Loja Teste está com tipo/setor corretos e fora do CRM
  UPDATE public.contatos
  SET tipo = 'loja',
      pipeline_coluna_id = NULL,
      setor_destino = '32cbd99c-4b20-4c8b-b7b2-901904d0aff6',
      metadata = COALESCE(metadata, '{}'::jsonb) || '{"nome_confirmado": true}'::jsonb
  WHERE id = _good_id;

  -- Saneia qualquer outro contato que tenha o telefone da Loja Teste em variantes
  PERFORM public.sanitize_corporate_contact('5584994244323');
  PERFORM public.sanitize_corporate_contact('558494244323');
END $$;