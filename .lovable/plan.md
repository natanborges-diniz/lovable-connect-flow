## Objetivo

Quando o agendamento passar para `confirmado` (cliente confirmou via WhatsApp ou IA), enviar **automaticamente** um aviso à loja correspondente pelo Atrium Messenger (notificação in-app + push), contendo: nome do cliente, horário/data, loja, e resumo do atendimento.

Hoje a loja só é cutucada **depois** do horário ("compareceu?"). Não existe aviso antecipado.

## Fluxo proposto

```text
Cliente confirma "sim/ok/confirmado"
        │
        ▼
whatsapp-webhook OU ai-triage marca agendamento.status = 'confirmado'
        │
        ▼
[NOVO] dispara helper notificar-loja-agendamento
        │
        ├─ Resolve destinatários da loja via resolver_destinatarios_loja(loja_nome)
        ├─ Monta título + mensagem com resumo
        └─ INSERT em notificacoes (1 por usuário)
                 │
                 ▼ (trigger trg_push_nova_notificacao já existe)
        Push FCM/APNs + badge in-app no Atrium Messenger
```

## Nova edge function: `notificar-loja-agendamento`

Recebe `{ agendamento_id }`, idempotente via `metadata.aviso_loja_enviado_at`.

Conteúdo da notificação:

- **Título:** `📅 Novo agendamento confirmado — {Nome do Cliente}`
- **Mensagem:**
  ```
  Cliente {nome} confirmou visita
  🗓 {dia da semana}, {DD/MM} às {HH:MM}
  📞 {telefone do cliente}
  
  Resumo:
  {resumo gerado pelo summarize-atendimento OU últimas observações do agendamento}
  ```

O resumo vem de:
1. Se `agendamento.atendimento_id` tem resumo recente em `metadata.resumo_ia`, usa.
2. Senão chama `summarize-atendimento` para gerar agora (síncrono, leve).
3. Fallback: usa `agendamento.observacoes` ou texto curto.

## Pontos de disparo (2 lugares)

1. **`whatsapp-webhook/index.ts`** (linha ~485): logo após o `update({ status: "confirmado" })`, invocar a nova EF.
2. **`ai-triage/index.ts`** (linha ~3362): mesmo padrão, após marcar `status: "confirmado"` no fluxo dia-D.

Ambos chamam via `fetch` para `notificar-loja-agendamento` em background (não bloqueia resposta ao cliente).

## Idempotência

- Antes de enviar: ler `agendamentos.metadata.aviso_loja_enviado_at`. Se existir, retorna `{skipped: true}`.
- Após enviar: gravar `metadata.aviso_loja_enviado_at = now()` e inserir evento em `eventos_crm` (`tipo: 'aviso_loja_agendamento'`).

## Edge case: loja sem destinatários

Se `resolver_destinatarios_loja` retornar vazio (caso da DINIZ ANTONIO AGU hoje, que não tem usuários app vinculados), criar **tarefa interna** para o supervisor com título "⚠️ Configurar usuários da loja {X} — agendamento confirmado sem destinatário" + log no `eventos_crm`. Assim nenhum agendamento fica sem aviso.

## Memória a salvar

Nova entrada `mem://agendamentos/aviso-loja-pos-confirmacao`:
> Após cliente confirmar agendamento (`status=confirmado` via WA-webhook ou ai-triage), `notificar-loja-agendamento` envia push+notificação in-app via Atrium Messenger aos usuários da loja com nome, horário e resumo. Idempotente via `metadata.aviso_loja_enviado_at`. Se loja sem destinatários → tarefa para supervisor.

## Fora de escopo

- Editor visual de template do aviso (texto fica no código por enquanto).
- Aviso para mudanças de horário/reagendamento (foco aqui é só confirmação inicial).
- Notificar loja via WhatsApp template — explicitamente vetado pela regra "Canal Único: B2B = App Atrium".
