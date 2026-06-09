## Problema

Ao transferir um lead do CRM para Lojas (dialog `TransferPipelineDialog`), o calendário desabilita o dia de hoje. A causa está em:

```ts
disabled={(date) => date < new Date()}
```

`new Date()` carrega a hora atual (ex.: 14h), enquanto cada célula do calendário representa meia-noite do respectivo dia. Resultado: hoje (00:00) fica menor que agora (14:00) e é bloqueado.

## Mudança

Em `src/components/pipeline/TransferPipelineDialog.tsx`, comparar contra o **início do dia de hoje**, liberando a data atual como opção válida:

```ts
disabled={(date) => {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return date < hoje;
}}
```

Nada mais muda: o campo de horário continua livre (o backend `agendar-cliente` já valida horário de funcionamento da loja e bloqueia agendamentos fora do intervalo, então tentar marcar para um horário que já passou é responsabilidade do operador — não precisamos adicionar nova trava aqui).

## Escopo

- Arquivo único: `src/components/pipeline/TransferPipelineDialog.tsx` (linha 232).
- Sem mudanças de backend, schema ou outras telas.
- O `AgendamentoDialog` (edição) já usa `datetime-local` sem restrição, então não é afetado.
