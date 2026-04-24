## Problema

Após confirmação de agendamento, Gael ofereceu proativamente: *"Posso já deixar separado um comparativo Essilor x ZEISS com filtro azul pra você ver na hora?"*. Cliente respondeu **"Sim"** e a IA não seguiu — caiu no fallback genérico *"Me explica melhor a sua necessidade…"*.

### Causa raiz
O detector `isDetalhamentoContext` em `ai-triage/index.ts` (linha 1780) só dispara se a mensagem do cliente contiver intent (`detalhar|diferença|comparar|…`) **OU** mencionar uma marca do orçamento. Uma resposta curta de confirmação (`sim`, `pode`, `manda`, `quero ver`) a uma oferta da própria IA não bate em nada disso → LLM perde o gancho e cai em fallback genérico.

Há também o caso oposto: cliente responde **"não"** à oferta — hoje não há fluxo de despedida, IA fica em loop genérico.

## Fluxo desejado

```text
IA: "...comparativo Essilor x ZEISS pra você ver na hora?"
                │
   ┌────────────┴────────────┐
  SIM                        NÃO
   │                          │
   ▼                          ▼
Envia comparativo das       "Tranquilo! Posso ajudar
2 marcas (das 3 do          em mais alguma coisa?"
orçamento) que cliente            │
demonstrou dúvida +         ┌─────┴─────┐
fecha: "Qualquer dúvida    SIM         NÃO
estou por aqui 👋"          │           │
                            ▼           ▼
                        continua    "Combinado, Artur!
                        ajudando    Te espero sábado
                                    25/04 às 17h na
                                    Diniz Primitiva I 👋"
```

## Mudanças

### 1. `supabase/functions/ai-triage/index.ts`

**(a) Detectar oferta-de-comparativo pendente da IA** (nova heurística próximo à linha 1764):
- Varre últimas **2 outbound** procurando por padrão `comparativo|comparar|deixar separado|posso (te )?(mostrar|enviar|deixar|preparar) .*(diferenç|comparativ|opç(ões|ao))|quer que eu (detalhe|compare|envie|mostre)` **e** menção a 2+ marcas do orçamento.
- Se encontrar, extrai as **marcas oferecidas** (regex sobre o texto da oferta).
- Variável: `pendingComparativoOffer = { marcas: ["Essilor", "Zeiss"], rawOffer: "..." } | null`.

**(b) Detectar resposta SIM/NÃO curta** quando há oferta pendente:
- `sim|isso|pode|manda|quero ver|claro|pode sim|por favor|adoraria|vamos|bora` → trata como **confirma comparativo** → ativa `isDetalhamentoContext = true` e força `orcamentoBrandsList = pendingComparativoOffer.marcas`.
- `não|nao|nao precisa|tranquilo|depois|deixa pra lá|tô bem|tudo certo` → ativa novo flag `isDispensaComparativoOffer = true`.

**(c) Atualizar bloco `[FLUXO DETALHAMENTO/COMPARAÇÃO DE LENTES]`**:
- Quando `pendingComparativoOffer` está presente e cliente confirmou, adicionar instrução: *"Cliente já agendou visita. Após o comparativo, FECHE o atendimento com algo como 'Te espero [data/hora] na [loja] — qualquer dúvida estou por aqui 👋'. NÃO pergunte se quer fechar nem agendar de novo."*
- Pega data/loja do agendamento mais recente (já disponível como `agendamentosAtivos`) e injeta no prompt.

**(d) Novo bloco de prompt `[FLUXO DESPEDIDA PÓS-AGENDAMENTO]`** quando `isDispensaComparativoOffer`:
- Detecta se houve uma negativa anterior recente para evitar perguntar 2x.
- 1ª negativa: *"Tranquilo! Posso te ajudar em mais alguma coisa antes de finalizar?"*
- 2ª negativa consecutiva (cliente já respondeu "não" à pergunta acima): mensagem de despedida formal usando dados do agendamento — *"Combinado, [Nome]! Te espero [data/hora] na [loja] 👋 Qualquer dúvida é só me chamar."* — e marca `intencao = "encerramento_pos_agendamento"`.

**(e) Fallback determinístico**: se LLM falhar nesses dois novos contextos, montar resposta hardcoded usando `pendingComparativoOffer.marcas` + dados do agendamento ativo (similar ao `detalhamentoFallback` existente).

**(f) Bypass de validador de similaridade** para o caso despedida (texto curto e canônico pode bater >70% com mensagens prévias de agendamento).

### 2. Nova memória `mem://ia/pos-agendamento-oferta-comparativo.md`

Documenta:
- Padrão de oferta proativa pós-agendamento confirmado (quando cliente teve dúvida entre marcas no orçamento).
- Fluxo SIM → comparativo + despedida; NÃO → ofereço ajuda → NÃO de novo → despedida.
- Frases canônicas de despedida com slot de loja/data/hora.
- Proibição de re-oferecer agendamento (já está marcado).

### 3. Atualizar `mem://ia/comparacao-lentes-detalhamento.md`

Acrescentar seção *"Quando comparativo é resposta a oferta da IA"*: regra de fechar com despedida vinculada ao agendamento, não com "quer fechar com uma delas?".

## Detalhes técnicos

- O detector de oferta usa as últimas 2 mensagens outbound (`recentOutbound.slice(-2)`) — janela curta porque resposta deve vir logo.
- Marcas extraídas da oferta via regex `/\b(Essilor|Zeiss|ZEISS|DNZ|Hoya|HOYA|Kodak|KODAK)\b/gi` (lista fechada para evitar falsos positivos como "Bom").
- `agendamentosAtivos` já é carregado antes do bloco de prompt — reaproveitar para data/loja na despedida.
- Contagem de "negativas consecutivas": olha últimas 2 inbound do cliente; se ambas negativas curtas e a penúltima outbound for a pergunta canônica de "posso ajudar em mais algo", aciona despedida.
- Deploy de `ai-triage` ao final.

## Resultado esperado

```text
Cliente: Sim  (após oferta de comparativo)
Gael: [parágrafo Essilor] + [parágrafo Zeiss] + "Combinado, Artur! Te espero sábado 25/04 às 17h na Diniz Primitiva I 👋 Qualquer dúvida é só me chamar."

Cliente: Não  (após oferta de comparativo)
Gael: "Tranquilo! Posso te ajudar em mais alguma coisa antes de finalizar?"
Cliente: Não
Gael: "Combinado, Artur! Te espero sábado 25/04 às 17h na Diniz Primitiva I 👋 Qualquer dúvida é só me chamar."
```
