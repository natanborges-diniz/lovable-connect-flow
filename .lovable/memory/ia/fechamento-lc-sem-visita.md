---
name: LC com catálogo — agendamento padrão
description: LC com receita+produto compatível segue agendamento normal (retirada na loja); humano só por objeção real
type: feature
---

## Política atual (28/04/2026)

LC tem catálogo no banco (`pricing_lentes_contato`) e a IA monta orçamento sozinha via `consultar_lentes_contato`. Cliente que escolhe marca / pede "reservar" segue o **mesmo fluxo de óculos**: IA pergunta região, indica loja mais próxima e usa `agendar_visita` para marcar a retirada/pagamento.

Humano só entra quando:
- Sem produto compatível no catálogo,
- Cliente pede explicitamente atendimento humano,
- Reclamação / objeção real.

## O que NÃO mudou

- LC não exige "tirar medidas" — proibido escrever isso. Use "retirar", "buscar", "fechar o pedido na loja".
- Tóricas / multifocais continuam sob encomenda — pagamento confirma reserva.

## Removidos do `ai-triage`

- Forçador `fechamento_lc` (era escalada compulsória).
- Short-circuit que mudava `modo=humano` antes do LLM.
- Guardrail `lc_agendamento_bloqueado` que bloqueava `agendar_visita` em LC.
