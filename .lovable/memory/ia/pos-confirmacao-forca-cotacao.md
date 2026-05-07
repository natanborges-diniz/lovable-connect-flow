---
name: Pós-Confirmação de Receita Força Cotação
description: Após cliente confirmar a receita lida via OCR (DENTRO da faixa), ai-triage chama runConsultarLentes deterministicamente; PROIBIDO devolver "Recebi sua receita / estou analisando" depois da confirmação
type: feature
---

# Pós-Confirmação de Receita — Cotação Determinística

## Caso Franciana (Mai/2026)

Cliente mandou foto, IA fez OCR e perguntou "Li sua receita assim, confere? 😊". Cliente respondeu "Sim". IA voltou com "Recebi sua receita 👀 Já estou analisando aqui pra te passar as opções certinhas, um instante…" — texto que pertence ao caminho de imagem ainda não interpretada. Cliente ficou esperando, watchdog viu outbound recente e silenciou.

## Correção em `ai-triage/index.ts`

### 1. Disparo determinístico no GATE (após `pending=false`, dentro da faixa)

No bloco `detectRxConfirmation(lastInboundText)` → `Confirmada DENTRO da faixa`, depois de marcar `pending=false`:

- Detecta contexto LC olhando os últimos 10 inbound (`/lente de contato|lc|diária|quinzenal|mensal|tórica|gelatinosa/`).
- Se NÃO for LC: chama `runConsultarLentes(supabase, contatoId, recentOutbound, { receita_label }, atendimento_id)` direto, anexa `MSG_REVISAO_HUMANA_SUFIXO` quando `requerRevisaoHumanaPosOrcamento` retornar `precisa=true`, envia via `sendWhatsApp` e retorna `tools_used=["consultar_lentes_pos_confirmacao"]`. Evento CRM `tipo="cotacao_pos_confirmacao_forcada"`.
- Se LC ou se `runConsultarLentes` jogar exceção: cai para o LLM normal (mantém comportamento atual).

### 2. Guardrail anti-"analisando" pós-LLM (seção 9.6)

Logo antes de `// ── 10. SEND RESPONSE ──`:

```
se (última receita.confirmed_by_client_at) e (resposta casa MSG_ANALISANDO_RE):
  - Não-LC → roda runConsultarLentes e substitui resposta (com MSG_REVISAO_HUMANA_SUFIXO se aplicável).
  - LC → resposta determinística "Já tô montando aqui as opções de lentes de contato…"
  - validatorFlags.push("anti_loop_analisando_pos_confirmacao")
```

Cobre tanto o ramo do gate quanto qualquer turno futuro em que o LLM volte a esse texto após confirmação.

## Por que NÃO mudei o `deterministicIntentFallback`

A pool de "Recebi sua receita 👀 Já estou analisando…" já só dispara quando `isImageContext=true`. Uma resposta texto curta tipo "Sim" não bate nesse caminho. O fix está nos dois pontos acima.

## Arquivos

- `supabase/functions/ai-triage/index.ts` — gate (~linha 2305) + guardrail 9.6 (~linha 4830).
