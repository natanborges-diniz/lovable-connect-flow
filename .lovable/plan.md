# Comprovante pós-link + Saneamento de encerramento no CRM

Duas frentes complementares: (a) parar de mandar comprovante de cliente para o humano e (b) garantir que **nenhum atendimento encerrado fique em coluna não-terminal** do CRM.

---

## PARTE A — Comprovante pós-link de pagamento

### Situação
Cliente recebe template `link_pagamento_*` e devolve print. `ai-triage` faz short-circuit, manda ack e seta `atendimentos.modo='humano'`. O humano só repassa para o Financeiro — etapa desnecessária.

### Decisões
- Comprovante do cliente é **informação adicional ao card existente** de link de pagamento — **sem coluna nova** no Financeiro.
- IA encerra o atendimento (sem virar humano) e o card é movido para **"Encerrados"** no CRM (ver Parte B).
- Webhook do OB segue como fonte de verdade financeira. Quando o Financeiro mover o card para "Concluído", automação manda mensagem fixa de confirmação ao cliente.

### Mudanças
**`supabase/functions/ai-triage/index.ts` — branch comprovante (substitui o atual):**
- Localiza `solicitacao tipo='link_pagamento'` mais recente do contato.
- Insere `solicitacao_anexos` (`tipo='comprovante_pagamento_cliente'`, url, mime, storage_path).
- `solicitacoes.metadata`: `comprovante_recebido_at`, `comprovante_url`, `comprovante_origem='cliente_whatsapp'`. **Não move coluna do card de link.**
- `pipeline_card_eventos.tipo='comprovante_cliente_recebido'` (timeline).
- `atendimentos.status='encerrado'`, `modo='ia'`, `metadata.encerramento_motivo='comprovante_recebido'`. Limpa cadências.
- Move o card do **CRM** (atendimento) para a coluna terminal **"Encerrados"** (ver Parte B).
- Envia ack fixo via `ia_mensagens_fixas` chave nova `comprovante_recebido_cliente`:
  _"Recebi seu comprovante 🙌 Já encaminhei para o Financeiro conferir. Assim que confirmar, te aviso por aqui. Obrigado!"_
- Notifica usuários do Financeiro (`notificacoes` + push via `resolver_destinatarios_setor('financeiro')`).
- Registra `eventos_crm.comprovante_pagamento_recebido`.

**`payment-webhook`:** ao marcar `pagamentos_link.status='pago'`, se existir anexo `comprovante_pagamento_cliente`, carimba `metadata.conciliado_com_print=true`.

**Automação de confirmação ao cliente:**
- `pipeline_automacoes` na coluna "Concluído" do Financeiro, gatilho `entrada_card`, ação `enviar_mensagem`:
  _"Olá {{nome_cliente}}, seu pagamento foi confirmado. Obrigado pela preferência! 💚 — Óticas Diniz"_
- Insere `ia_mensagens_fixas` chave `comprovante_recebido_cliente`.

---

## PARTE B — Conceito de encerramento no CRM (Vendas)

### Conceito
| Termo | Significado | Coluna destino |
|---|---|---|
| **Ganho** | Virou cliente / agendou / pagou | colunas existentes ("Agendado", "Link Pago", etc.) |
| **Perdido** | Houve oportunidade comercial (orçamento ou produto discutido) e não converteu | **Perdidos** (já existe) + `motivo_perda` |
| **Encerrado** | Sem potencial de venda na conversa (info, comprovante, dúvida resolvida, contato errado, etc.) | **Encerrados** (criar) |
| Status do chat | `aberto` / `encerrado` — só badge no card | n/a |

**Regra-mãe:** atendimento `status='encerrado'` em coluna não-terminal do CRM ⇒ card precisa ser movido para Ganho, **Perdidos** ou **Encerrados**. Nunca fica em Novo Contato, Retorno, Comercial, etc.

### Mudanças
**1. Migração:**
- Cria coluna **"Encerrados"** no setor CRM (terminal, `ativo=true`, ordem após Perdidos).
- Adiciona `solicitacoes.metadata.encerramento_motivo` (texto livre — ex.: `comprovante_recebido`, `info_resolvida`, `contato_errado`, `sem_oportunidade`).

**2. `Pipeline.tsx` / fluxo "Encerrar":**
- Botão Encerrar abre **dialog de desfecho** com 3 opções:
  - **Ganho** → mantém na coluna atual ou move conforme regra de venda existente (sem alteração).
  - **Perdido** → exige `motivo_perda` (select com motivos padrão), move para Perdidos.
  - **Encerrado (sem oportunidade)** → exige `encerramento_motivo` curto (select com presets + texto livre), move para Encerrados.
- Em todos os casos: `atendimentos.status='encerrado'`, limpa cadências, gera resumo (`summarize-atendimento` — já existe).

**3. Backfill / saneamento:**
- Cron `watchdog-loop-ia` já move "lead silencioso" para Perdidos — manter.
- Migração de dados: cards atualmente em colunas não-terminais com último atendimento encerrado há >24h → mover automaticamente para **Encerrados** (motivo `backfill_orfao`).

**4. IA — encerramentos automáticos:**
- Quando IA encerra por **despedida canônica pós-agendamento**: move para coluna do agendamento (já faz).
- Quando IA encerra por **comprovante recebido** (Parte A): move para **Encerrados** com motivo `comprovante_recebido`.
- Quando watchdog encerra **lead silencioso após cadência**: continua indo para **Perdidos** (houve tentativa de venda).

---

## Fora de escopo
- Outros pipelines (Financeiro/TI/Lojas) — regra fica só no CRM por ora.
- Boleto (sem confirmação automática hoje).
- Contato loja/colaborador continua via `notificarLojaApp`.

## Memórias a atualizar
- `mem://ia/comprovante-vs-receita-prioridade.md`: trocar "escala humano" por "anexa ao card existente + encerra atendimento + move CRM para Encerrados + notifica Financeiro".
- Nova `mem://crm/colunas-terminais-encerramento.md`: regra Ganho/Perdido/Encerrado + obrigatoriedade de coluna terminal.
- `mem://crm/fluxo-encerramento-atendimento.md`: passa a exigir desfecho.
