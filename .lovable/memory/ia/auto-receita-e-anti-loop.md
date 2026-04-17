---
name: Auto-OCR + Anti-Loop
description: Image+quote intent triggers automatic interpretar_receita; loop detector forces tool execution or escalates to human
type: feature
---

# Auto-OCR e Anti-Loop (ai-triage)

## Auto-disparo de `interpretar_receita`
Quando há imagem inbound recente sem receita salva e o cliente sinaliza intenção de orçamento (palavras-chave: "orçamento", "preço", "valor", "lentes compatíveis", "opções"), o `ai-triage` injeta hint de sistema obrigando o uso de `interpretar_receita` antes de qualquer pergunta. Não é mais permitido perguntar "quer que eu analise?" — a IA analisa direto.

## Loop detector (pré-LLM)
Função `detectLoop(recentOutbound)` roda **antes** do LLM e antes do guardrail de similaridade. Se 2 das últimas 3 mensagens outbound têm >70% de similaridade:
- Se há intent claro do cliente (orçamento/agendar) → injeta hint de sistema forçando a tool correspondente (`consultar_lentes`, `interpretar_receita`, `agendar_visita`).
- Se não há intent claro → escala imediatamente para humano (`modo='humano'`), envia mensagem discreta ao cliente e loga `loop_ia_escalado` em `eventos_crm`.

## Forced intent → tool
Mapeamento determinístico:
- "orçamento" + receita salva → `consultar_lentes`
- "orçamento" + imagem pendente → `interpretar_receita`
- "agendar" / "marcar" → `agendar_visita`

Esse hint é injetado no prompt como `[SISTEMA: INTENT CLARO]` mesmo sem loop, para evitar que o modelo volte ao prompt anterior por inércia.

## Watchdog (cron 2 min)
Edge function `watchdog-loop-ia` verifica atendimentos `modo='ia'` cuja última mensagem é outbound (de IA, não humano) há >5min, com inbound prévio do cliente e similaridade >70% entre as últimas 2 outbound. Ação: muda para `modo='humano'`, registra `loop_ia_escalado_watchdog` e cria notificação "Card em loop — requer atenção".

## Salvaguardas
- Watchdog ignora outbounds humanas (verifica `remetente_nome`).
- Loop detector só age com ≥3 outbound recentes.
- Eventos detalhados em `eventos_crm` para auditoria.
