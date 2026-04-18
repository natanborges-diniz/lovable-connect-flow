-- Re-sanea o contato 8878 com a nova lógica (respeitando setor_destino_id de telefones_lojas)
SELECT public.sanitize_corporate_contact('5511963268878');

-- Garante que a ponte está ativa pra esse contato
SELECT public.setup_contato_ponte(id) FROM public.contatos WHERE telefone = '5511963268878';