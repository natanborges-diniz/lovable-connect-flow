---
name: Orphan Conversation Recovery
description: Manual post-downtime recovery flow with audience selector (Clientes/Internos/Todos)
type: feature
---

Edge function `recuperar-atendimentos` lista atendimentos não-encerrados onde a última mensagem é `inbound` e mais antiga que X minutos. Acionada manualmente em **Configurações → Recuperação** (admin), nunca automática (evita disparo em massa).

## Seletor de Público (UI)
3 botões grandes no topo do `RecuperacaoCard.tsx`:
- **Clientes** (default): `setor_id IS NULL` — consumidores finais do CRM Vendas. Caso típico "ligar IA pós-downtime".
- **Lojas/Internos**: `setor_id IS NOT NULL` — Atendimento Corporativo, Lojas, Financeiro, TI.
- **Todos**: sem filtro.

Cada botão exibe contagem (badge) e tooltip explicativo. Filtros avançados (idade, setor específico, modo) ficam num `Collapsible` abaixo.

## Backend
EF aceita `?publico=clientes|internos|todos` e retorna `{ total, orfaos, por_publico: { clientes, internos } }`. Heurística: `setor_id` da fila do atendimento — null = cliente, não-null = interno.

## Ações disponíveis (individual ou em lote)
- `acionar_ia` — chama `ai-triage` com `forcar_processamento: true`
- `escalar_humano` — modo=humano, prioridade=alta, notifica setor, envia desculpas opcional
- `mensagem_desculpas` — só dispara WhatsApp via `send-whatsapp`
- `lote_inteligente` — regra: <1h IA / 1-6h IA com prefixo desculpa / >6h escala humano + desculpas

Modal de confirmação do lote inteligente mostra preview segmentado (quantos cairão em cada faixa).

Auditoria via `eventos_crm.tipo='recuperacao_orfao'`. Hook `useAtendimentosOrfaos` (refetch 30s).
