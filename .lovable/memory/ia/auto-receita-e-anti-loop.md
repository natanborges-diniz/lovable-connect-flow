---
name: Auto-OCR + Anti-Loop + Fluxo Pós-Receita
description: Image+quote intent triggers automatic interpretar_receita; loop detector forces tool execution or escalates; post-receita flow forces consultar_lentes → opções → região → agendamento
type: feature
---

# Auto-OCR, Anti-Loop e Fluxo Pós-Receita (ai-triage)

## Auto-disparo de `interpretar_receita`
Quando há imagem inbound recente sem receita salva e o cliente sinaliza intenção de orçamento (palavras-chave: "orçamento", "preço", "valor", "lentes compatíveis", "opções"), o `ai-triage` injeta hint de sistema obrigando o uso de `interpretar_receita` antes de qualquer pergunta. Não é mais permitido perguntar "quer que eu analise?" — a IA analisa direto.

## Pós-leitura — fluxo obrigatório (NOVO)
Quando `receitas.length > 0` (já existe receita interpretada salva), o `ai-triage` injeta hint determinístico forçando os 4 passos:
1. `consultar_lentes` AGORA com os valores da receita mais recente
2. Apresentar 2-3 opções (DNZ entrada / DMAX custo-benefício / HOYA premium) com valores retornados
3. Perguntar região/bairro do cliente
4. Sugerir agendamento na loja mais próxima

**PROIBIDO:** "posso te mostrar uma base?", "quer que eu mostre opções?", confirmação genérica. Confirmação só se confiança baixa (mostrar "OD X,XX / OE Y,YY, confere?"). Repetir confirmação 2× = loop = escalada.

Reforço em `ia_regras_proibidas` (categoria comportamento) + exemplo modelo em `ia_exemplos` (categoria pos_receita_fluxo).

## Loop detector (pré-LLM)
Função `detectLoop(recentOutbound)` roda **antes** do LLM e antes do guardrail de similaridade. Se 2 das últimas 3 mensagens outbound têm >70% de similaridade:
- Se há intent claro do cliente (orçamento/agendar) → injeta hint forçando a tool correspondente.
- Se não há intent claro → escala imediatamente para humano (`modo='humano'`), envia mensagem discreta e loga `loop_ia_escalado` em `eventos_crm`.

## Forced intent → tool
Mapeamento determinístico:
- "orçamento" + receita salva → `consultar_lentes`
- "orçamento" + imagem pendente → `interpretar_receita`
- "agendar" / "marcar" → `agendar_visita`

## Watchdog (cron 2 min)
`watchdog-loop-ia` verifica atendimentos `modo='ia'` cuja última mensagem é outbound de IA há >5min, com inbound prévio e similaridade >70% entre últimas 2 outbound. Ação: muda para `modo='humano'`, loga `loop_ia_escalado_watchdog` e cria notificação.

## Caso documentado — Rosana (2026-04)
Cliente enviou receita; IA interpretou ("boa parte"), mas travou em "posso te mostrar uma base e confirmar na loja?" e repetiu 2× → escalou para humano. Causa raiz: faltava hint pós-receita forçando `consultar_lentes`. Corrigido com bloco `receitas.length > 0` no `ai-triage` + regra proibida + exemplo modelo.

## Salvaguardas
- Watchdog ignora outbounds humanas.
- Loop detector só age com ≥3 outbound recentes.
- Eventos detalhados em `eventos_crm` para auditoria.
