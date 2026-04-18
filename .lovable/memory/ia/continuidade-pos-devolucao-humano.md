---
name: Continuity After Handoff (Silent)
description: "Devolver para IA" é troca de modo silenciosa — IA aguarda próxima mensagem do cliente antes de falar
type: feature
---

## Regra
"Devolver para IA" no Pipeline/Atendimentos é **troca silenciosa de modo**:
- Frontend apenas faz `update modo='ia'` + toast "IA reativada — aguardando retorno do cliente".
- **Não dispara** `ai-triage`, não envia mensagem nenhuma.
- IA permanece em espera passiva.

## Retomada
Quando o cliente envia próxima mensagem:
- `whatsapp-webhook` dispara `ai-triage` no fluxo normal.
- Histórico completo (incluindo falas do humano com prefixo `[HUMANO - Nome]`) já está no contexto via prompt-compiler.
- IA retoma com tom natural, ciente do que o humano resolveu.

## Por quê
Evita IA "falando sozinha" logo após o handoff, o que quebrava continuidade e gerava mensagens descontextualizadas. O cliente dita o ritmo.

## Implementação
- `src/pages/Pipeline.tsx` (`handleSetModo`) e `src/pages/Atendimentos.tsx` (badge IA/Humano): apenas `update` + toast.
- `ai-triage` não precisa de tratamento especial — o histórico cobre o contexto.
