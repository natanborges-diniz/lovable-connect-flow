# Régua de links/Pix pendentes

Aplicar a migration `20260731210000_regua_links_pendentes.sql` exatamente como está no repositório, sem alterar nenhum arquivo.

## O que ela faz

- **Fase 1 — lembrete (4h a 24h sem pagamento):** comentário automático na solicitação (visível no Messenger) + notificação para os usuários da loja, uma única vez.
- **Fase 2 — expiração (após 24h ou `expira_em` vencido):** solicitação vira `cancelada`, vai para a coluna Cancelado do Financeiro, é arquivada, o `pagamentos_link` vira `expirado`, e a loja é avisada para gerar nova cobrança se necessário.
- **Agendamento:** `pg_cron` de hora em hora, no minuto 10.

## Verificações já feitas

- `resolver_destinatarios_loja` existe.
- Colunas usadas existem (`pagamentos_link.expirado_at/status/solicitacao_id`, `solicitacao_comentarios`, `notificacoes`).
- Coluna "Cancelado" do setor Financeiro existe e está ativa.
- A função `regua_links_pendentes` ainda não existe e o job `regua-links-pendentes` ainda não está agendado.

## Atenção — impacto na primeira execução

Hoje há **39 cobranças** em aberto com mais de 24h que serão canceladas/arquivadas e **1** que receberá lembrete já na primeira rodada (dentro de até 1 hora). Isso é o comportamento pretendido da régua, mas é uma limpeza retroativa em massa. Se preferir, posso rodar a migration e só depois agendar o cron, ou fazer a primeira limpeza de forma controlada.

## Passos

1. Executar a migration completa (função + `cron.schedule`).
2. Confirmar que a função foi criada e o job `regua-links-pendentes` está ativo em `cron.job`.
