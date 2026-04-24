---
name: Fechamento de Lentes de Contato — sem visita à loja
description: Após cliente escolher marca/modelo de LC ou pedir reservar, IA encaminha direto para Consultor humano (loja de retirada definida no fechamento). Proibido agendar_visita / "tirar medidas" para LC.
type: feature
---

## Regra de negócio
Lentes de contato **não exigem visita à loja para "tirar medidas"** — a receita do cliente já basta. Quando o cliente escolhe uma marca/modelo OU pede para reservar/fechar/comprar, a IA:

1. Confirma a escolha em uma frase curta.
2. Lembra que tóricas/multifocais são sob encomenda e o pagamento confirma a reserva.
3. **Encaminha para Consultor humano** (`atendimentos.modo='humano'`).
4. **NÃO** pergunta dia/horário, **NÃO** oferece visita, **NÃO** usa "tirar medidas".

A loja de retirada é escolhida pelo cliente **no fechamento, com o humano** — não na triagem.

## Implementação em `ai-triage/index.ts`

### 1. `detectForcedToolIntent` — novo intent `fechamento_lc`
Recebe `isLCContext` e `hasLCQuotePresented`. Dispara `fechamento_lc` quando, em contexto LC + receita salva:
- texto contém marca de LC + verbo de reserva (ex.: "quero reservar Acuvue"), OU
- já apresentamos opções (`hasLCQuotePresented`) e o cliente respondeu com **marca isolada** (ex.: "Acuvue") ou **verbo isolado** ("quero reservar").

Regex usadas: `LC_BRAND_REGEX` (acuvue, oasys, biofinity, air optix, solflex, solótica, dnz, etc.) e `RESERVE_VERBS_REGEX` (quero reservar/fechar/pedir/levar, vou querer, fica com, fechar, reservar...).

Também: em contexto LC + receita, "reservar/marcar" no branch de scheduling é redirecionado para `fechamento_lc` (NUNCA `agendar_cliente_intent`).

### 2. Short-circuit pré-LLM (após `forcedIntent`)
Quando `forcedIntent.tool === 'fechamento_lc'`:
- Envia mensagem deterministic: "Perfeito, [nome] — anotei sua escolha: *Marca* 👌\n\nVou te passar agora pra um Consultor da nossa equipe finalizar o pedido — com ele você confirma o modelo certo da sua receita, escolhe em qual loja prefere retirar e recebe o link de pagamento. Em instantes ele te chama por aqui mesmo 🤝"
- `atendimentos.modo = 'humano'`
- `eventos_crm` tipo `fechamento_lc_escalado` com `marca_escolhida`, `had_lc_quote_presented`, `reason`.
- Dispara `summarize-atendimento` para o humano ter o resumo.
- Limpa `metadata.ia_lock` e retorna sem chamar o LLM.
- Card permanece na coluna atual (modo='humano' já basta).

### 3. Guardrail no handler `agendar_visita` / `reagendar_visita`
Se `isLCContextGlobal && receitas.length > 0` quando o modelo chamou `agendar_visita`:
- Bloqueia a tool, registra `eventos_crm` tipo `lc_agendamento_bloqueado`.
- Substitui resposta por: "Pra lente de contato você não precisa vir até a loja tirar medidas — sua receita já basta 😉 Vou te passar agora pra um Consultor..."
- `precisa_humano = true`, `validatorFlags.push('lc_agendamento_bloqueado')`.

### 4. Bloco no system prompt LC (`buildLentesContatoKnowledgeBlock`)
Seção "🚫 FECHAMENTO DE LENTES DE CONTATO — REGRA DURA":
- LC NUNCA exige visita para "tirar medidas".
- Proibido `agendar_visita` para LC.
- Proibido escrever "tirar medidas", "posso te receber", "vir até a loja para finalizar", "qual dia/horário" em contexto LC.
- Após escolha → confirmar em 1 frase + reforço de encomenda (se tórica) + encaminhar para humano + a loja de retirada é definida no fechamento.

## Casos de regressão documentados

**Artur Borges (24/04/2026 16:40):** Após orçamento de LC, cliente disse "Quero reservar Acuvue". IA respondeu "Posso te receber na Diniz Carapicuíba para finalizar e tirar as medidas. Qual dia e horário você prefere?" — dois erros: (1) pediu visita para tirar medidas (LC não exige), (2) não escalou para humano fechar. Correção: intent `fechamento_lc` + short-circuit + guardrail no `agendar_visita` + bloco "regra dura" no prompt LC.

## Pendências (próxima iteração se voltar a falhar)
- Validador pós-LLM que rejeite resposta com "tirar medidas" / "posso te receber" / "qual dia / qual horário" em contexto LC (hoje a guarda é determinística no `detectForcedToolIntent` + `agendar_visita` handler; se o modelo escrever a frase por texto sem chamar tool, ainda escapa).
