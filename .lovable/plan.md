# Rastreabilidade: mostrar a Consulta de CPF de origem no card de Boleto

## Diagnóstico (verificado)

O boleto SOL-2026-00204 **tem sim** uma Consulta de CPF aprovada por trás:

- Consulta: SOL-2026-00190, criada em 01/08, `resultado_consulta = aprovado`
- Mesma loja (DINIZ PRIMITIVA II), mesmo CPF e mesmo cliente
- Vínculo bidirecional gravado corretamente (`consulta_cpf_id` no boleto, `boleto_solicitacao_id` e `boleto_gerado_at` na consulta)

A regra é validada no servidor para qualquer usuário (inclusive admin), sem exceção por papel: exige consulta informada, aprovada, da mesma loja, ainda não usada em outro boleto e com menos de 30 dias.

Conclusão: não existe caminho de boleto sem consulta aprovada. O problema real é que o card do boleto não exibe essa origem, o que gera a dúvida.

## O que fazer

No bloco "SOLICITAÇÃO DE BOLETO" (picote amarelo) do card de boleto, acrescentar uma linha de origem:

- `🪪 Consulta CPF — SOL-2026-00190 · aprovada em 01/08` clicável, abrindo a solicitação de consulta original.
- Se `metadata.consulta_cpf_id` estiver ausente (casos legados), mostrar aviso discreto "Sem consulta vinculada (legado)".

Complementarmente, na Consulta de CPF já aprovada exibir o protocolo do boleto gerado como link (hoje só há badge de data).

## Detalhes técnicos

- Frontend apenas. Componente do picote de boleto usado em `PipelineFinanceiro.tsx` / `MesaFinanceiro.tsx`.
- Buscar `protocolo`, `created_at` e `metadata.data_analise` da solicitação em `metadata.consulta_cpf_id` (uma consulta por card, com cache do react-query).
- Sem mudança de backend, migration ou regra de negócio.
