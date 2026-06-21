UPDATE contatos SET metadata = metadata - 'receitas' - 'ultima_receita' - 'receita_confirmacao' - 'pos_orcamento'
WHERE telefone LIKE '%11963268878%';

UPDATE atendimentos SET metadata = metadata - 'expected_reply' - 'pos_orcamento'
WHERE contato_id IN (SELECT id FROM contatos WHERE telefone LIKE '%11963268878%')
  AND status != 'encerrado';