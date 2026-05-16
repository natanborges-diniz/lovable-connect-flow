---
name: WhatsApp Interativo — Determinismo via button_id
description: Botões/listas Meta substituem confirmações por texto. button_id é roteado deterministicamente em ai-triage (sem regex/LLM). Limites Meta + guard 24h.
type: feature
---

## Princípio

Confirmações e escolhas dentro da janela 24h usam **interactive messages** (button ou list) Meta. Quando o cliente toca, o webhook propaga `button_id` para `ai-triage`, que executa um handler determinístico — **NUNCA passa por regex ou LLM** quando há `button_id`.

## Pipeline

1. `send-whatsapp` aceita campo `interactive: { type, texto, botoes?, lista? }`. Se Meta rejeitar payload interativo, faz fallback automático para texto.
2. `whatsapp-webhook` extrai `interactive.button_reply` ou `list_reply` → injeta `button_id` + `button_title` em `mensagens.metadata` e no invoke do `ai-triage`.
3. `ai-triage` roda `routeButtonClick()` no topo do handler. Se casar, executa e retorna — bypassa `classifyIntent` e LLM.

## Map button_id → handler

| ID | Ação |
|---|---|
| `orcamento` | Envia botões `receita_foto/digitar/sem` |
| `status_pedido` | Escala para humano (consulta OS) |
| `duvida` | Marca intent, libera LLM |
| `reclamacao` | Escala para humano |
| `agendar` | Envia lista de lojas |
| `receita_foto` | Pede foto, seta `aguardando_receita_foto` |
| `receita_digitar` | Envia `MSG_PEDIR_RECEITA_TEXTO` |
| `receita_sem` | Modo faixa estimada |
| `receita_ok` | Confirma `receita_pending` → botões adicionais |
| `receita_corrigir` | Reset `receita_pending`, pede texto |
| `adicional_azul/foto/nao` | Salva `adicionais_pending` e libera LLM cotar |
| `orcamento_agendar` | Lista lojas |
| `orcamento_duvida` | Libera LLM |
| `orcamento_mais_barato` | Oferece 20% via botões desconto_* |
| `desconto_aceito` | Lista lojas |
| `desconto_loja` | Envia endereços |
| `desconto_pensar` | Despedida cordial |
| `loja:<uuid>` | Salva escolha em `agendamento_pending.loja_id` |
| `ag_confirmar` | Chama `agendar-cliente` com `agendamento_pending` |
| `ag_mudar` | Pede nova data/hora |
| `ag_cancelar` | Limpa `agendamento_pending` |
| `show_confirma` | Confirma presença dia-D, notifica loja |
| `show_remarcar` | Lista lojas |
| `show_nao` | Cancela agendamento |
| `recupera_sim` | Lista lojas |
| `recupera_loja` | Envia endereços |
| `recupera_nao` | Marca `recuperacao_recusada_at` |

## Limites Meta (truncados automaticamente)

- Button: máx 3, `title` ≤20 chars
- List: máx 10 itens, `label` ≤20, `section` ≤24, `title` ≤24, `description` ≤72
- `body.text` ≤1024

## Guard 24h

Interactive **só funciona dentro da janela 24h** (Meta exige). Fora dela, usar `send-whatsapp-template` com templates aprovados que tenham `BUTTONS` cadastrados na Meta.

## Pontos onde já é emitido

- `agendamentos-cron`: lembrete véspera (08h SP) + lembrete 1h antes → botões `show_*`
- `ai-triage` router: orçamento, receita confirmação, adicionais, reação ao orçamento, desconto, lista de lojas, confirmação agendamento

## Estado pendente em `atendimento.metadata`

- `receita_pending` — receita interpretada aguardando `receita_ok`
- `adicionais_pending` — args parciais de cotação
- `agendamento_pending` — `{ loja_id, loja_nome, data_horario }` aguardando `ag_confirmar`
- `ultimo_button_id` + `ultimo_button_at` — auditoria do último clique

## Escopo

- B2B/InFoco Messenger **não** recebe botões (canal interno só notificações in-app).
- Não toca em fluxo de templates fora-janela.
- Não muda esquema de tools do LLM — apenas redireciona quando há `button_id`.
