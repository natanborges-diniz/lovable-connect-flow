---
name: CRM — colunas terminais e regra de encerramento
description: Nenhum atendimento encerrado pode ficar em coluna não-terminal do CRM. Três desfechos possíveis (Ganho / Perdido / Encerrado) com regra de destino claro.
type: feature
---

## Conceito (convenção universal de CRM)
Coluna do Kanban = **estágio comercial** do lead. Status do atendimento (`aberto`/`encerrado`) é atributo do registro, renderizado como **badge**, nunca como coluna.

## Três desfechos possíveis ao encerrar
| Desfecho | Significado | Coluna destino |
|---|---|---|
| **Ganho** | Agendou / pagou / comprou | mantém coluna atual (Agendado, Link Pago, etc.) |
| **Perdido** | **Houve oportunidade comercial** (orçamento ou produto discutido) e não converteu | **Perdidos** + `metadata.motivo_perda` |
| **Encerrado** | Sem potencial de venda (dúvida resolvida, comprovante, contato errado, spam) | **Encerrados** (setor_id NULL, ordem 11) + `metadata.encerramento_motivo` |

## Regra-mãe
Atendimento `status='encerrado'` em coluna não-terminal (Novo Contato, Retorno, Lead, Qualificado, Orçamento, Agendamento, Informações Gerais, Reclamações, etc.) é **inconsistente**. Card deve ser movido para Ganho-em-coluna-de-venda, Perdidos ou Encerrados.

## UI — `EncerrarAtendimentoDialog`
- Botão "Encerrar" abre dialog com 3 opções (Ganho/Perdido/Encerrado).
- Perdido e Encerrado exigem `motivo` (select com presets) + observação opcional.
- Persiste em `atendimentos.metadata.desfecho`, `motivo_perda` ou `encerramento_motivo`.
- Move `contatos.pipeline_coluna_id` quando aplicável.
- Dispara `pipeline-automations` na coluna destino (gatilho `entrada_card`).
- Gera resumo via `summarize-atendimento` (best-effort).

## Encerramentos automáticos
- **Comprovante recebido** (ai-triage) → Encerrados, motivo `comprovante_recebido`.
- **Despedida canônica pós-agendamento** → mantém na coluna do agendamento (Ganho).
- **Watchdog lead silencioso** (`watchdog-loop-ia`) → Perdidos (houve tentativa de venda).

## IDs operacionais
- CRM = `setor_id IS NULL`.
- Perdidos = `e3893ea7-2577-4ec7-9fe9-c7c09e75ead3`.
- Encerrados = `2ccace4d-73ee-4fdc-b444-468d5fb95dc5`.
