---
name: Regras de negócio críticas + popover "Receita lida"
description: Quando o popover de validação aparece e proibições de orçamento sem foto/escalada
type: feature
---

## Popover "📄 Receita lida pelo Gael"

Renderiza apenas quando `atendimentos.metadata.revisao_humana_pendente === true`.

A flag é setada em DOIS caminhos do `ai-triage`:

1. **Cotação automática com receita complexa** (`requerRevisaoHumanaPosOrcamento`, ~linha 5404): cyl > 4 (`cilindrico_alto`), add > 3.5 (`adicao_alta`), sphere 8–10 (`esferico_faixa_cinza`). IA cota normal e liga a flag pra equipe conferir prazo/disponibilidade.

2. **Escalada por receita fora-da-faixa** (~linha 2257, `foraDaFaixa === true`): sphere > 10 ou outro motivo de catálogo. IA escala para humano (`MSG_ESCALADA_GRAU_FORA_FAIXA`) e liga a flag para o consultor validar a leitura antes de cotar manualmente. Motivos enriquecidos com `cilindrico_alto:X` / `esferico_fora_catalogo:X` quando aplicável.

Eventos `eventos_crm`:
- `orcamento_revisao_validada` — consultor aprovou a leitura.
- `orcamento_revisao_rejeitada` — consultor pediu nova leitura ao Gael.

## Outras regras críticas
- Sem exames médicos na loja.
- Priorizar visita à loja.
- Foto de receita é OBRIGATÓRIA antes de cotar óculos.
- Lentes de contato cotam com receita salva via `consultar_lentes_contato`.
