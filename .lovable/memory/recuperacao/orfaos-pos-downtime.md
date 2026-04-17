---
name: Orphan Conversation Recovery
description: Manual post-downtime recovery flow for atendimentos with last inbound message unanswered
type: feature
---

Edge function `recuperar-atendimentos` lista atendimentos não-encerrados onde a última mensagem é `inbound` e mais antiga que X minutos. Acionada manualmente em **Configurações → Recuperação** (admin), nunca automática (evita disparo em massa).

Ações disponíveis (individual ou em lote):
- `acionar_ia` — chama `ai-triage` com `forcar_processamento: true` (bypassa debounce 5s e trava outbound 10s)
- `escalar_humano` — modo=humano, prioridade=alta, notifica setor, envia template de desculpas opcional
- `mensagem_desculpas` — só dispara WhatsApp via `send-whatsapp`
- `lote_inteligente` — regra: <1h IA / 1-6h IA com prefixo desculpa / >6h escala humano + desculpas

Auditoria via `eventos_crm.tipo='recuperacao_orfao'`. UI em `RecuperacaoCard.tsx`, hook `useAtendimentosOrfaos` (refetch 30s).
