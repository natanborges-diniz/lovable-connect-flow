
# Corrigir IA: leu receita, perguntou região e escalou em vez de orçar

## O que aconteceu (caso Paulo Henrique, atendimento `26464d89`)

```
IA  → "Consegui ler sua receita: OD esf 0.00 cil -2.00 / OE esf 0.00 cil -2.50.
       Já vou separar opções. Em qual região você está?"   ← falhou aqui (1)
Cliente → "Osasco centro"
IA  → "Para esse grau específico, vou encaminhar para um Consultor..."  ← falhou aqui (2)
Cliente → "Pode"
IA  → "Conta pra mim com mais detalhes..."  ← perdeu o contexto
```

Receita salva no banco está **válida** (`rx_type=single_vision`, OD -2.00 / OE -2.50, conf 0.9). Não há nenhuma justificativa técnica para escalar — é exatamente o cenário em que o motor de orçamento (`consultar_lentes`) deveria rodar.

## Diagnóstico (2 falhas em sequência no `ai-triage`)

### Falha 1 — Auto-chain pós-OCR não disparou
Em `supabase/functions/ai-triage/index.ts` ~linha 2750:

```ts
const wantsQuote = /\b(or[cç]amento|...|preço|valor|quanto|opções|...)\b/i.test(recentInboundJoined);
if (rxJustValid && wantsQuote && !isLCRecent) {
  // encadeia consultar_lentes no MESMO turno
}
```

A regex `wantsQuote` exige que o cliente tenha dito explicitamente "orçamento/preço/valor/opções". Quando o cliente só envia a foto da receita (sem texto, ou texto neutro tipo "minha receita"), o auto-chain **não dispara** e a IA limita-se a anunciar "vou separar as opções". Resultado: gasta um turno extra perguntando a região antes de orçar.

### Falha 2 — IA escalou para humano com receita válida + região respondida
No turno seguinte, `currentMsg = "Osasco centro"` não bate nenhum keyword de orçamento, então `detectForcedToolIntent` retorna `null` — não força `consultar_lentes`. O hint "FLUXO PÓS-RECEITA OBRIGATÓRIO" (linha 2126) está ativo, mas:

- Proíbe "posso te mostrar uma base?" e "quer que eu mostre opções?"
- **Não proíbe explicitamente escalar para humano** quando há receita válida + grau dentro do range comercial.

O modelo escolheu "Para esse grau específico, vou encaminhar para um Consultor" — escalada injustificada (grau -2.00/-2.50 é trivial, dentro do range de qualquer linha do catálogo).

## Correções

### 1. Auto-chain: incluir gatilho "leia/interprete a receita" + qualquer foto sem texto neutro

`supabase/functions/ai-triage/index.ts` ~linha 2750 — relaxar `wantsQuote` para também encadear quando:
- Receita é válida (`rxJustValid`)
- Não há texto contraditório (cliente não pediu só "guarde a receita" ou "depois")
- O contexto é óculos (sem `isLCRecent`)

Nova condição: encadeia `consultar_lentes` por padrão pós-OCR válido para óculos, salvo se o último inbound do cliente indicar explicitamente outra intenção (ex.: "só queria que você guardasse", "depois te falo"). Isso elimina o turno desperdiçado "vou separar opções → pergunta região". A pergunta de região passa a ir junto com o orçamento (já é parte do template do `runConsultarLentes`).

### 2. Forçar `consultar_lentes` quando cliente responde região logo após receita interpretada

Em `detectForcedToolIntent` (~linha 324) — adicionar detecção:
- Se a última mensagem outbound da IA terminou perguntando região/bairro
- E a mensagem inbound atual responde com nome de cidade/bairro/CEP
- E há receita válida salva

→ retorna `{ tool: "consultar_lentes", reason: "cliente respondeu região após IA prometer orçamento" }`

### 3. Reforçar hint pós-receita contra escalonamento injustificado

Linha 2126 — adicionar à lista de PROIBIDOS:
> "PROIBIDO escalar para humano com mensagens tipo 'vou encaminhar para um Consultor', 'para esse grau específico vou passar para alguém da equipe' quando a receita está dentro do range comercial (esférico até ±10, cilíndrico até ±4). Escalada só é permitida se: (a) o motor `consultar_lentes` retornou ZERO opções, (b) cliente pediu humano explicitamente, ou (c) há reclamação grave."

### 4. Nova regra proibida no banco (`ia_regras_proibidas`)

Categoria `comportamento`:
> "Nunca escalar para humano logo após interpretar receita com grau dentro do range comercial. Sempre rodar `consultar_lentes` primeiro e mostrar 2-3 opções. Escalada só após o orçamento ser entregue."

### 5. Novo exemplo modelo em `ia_exemplos`

Categoria `pos_receita_fluxo`:
- Pergunta: cliente envia foto da receita + "queria um orçamento"
- Resposta ideal: IA chama `interpretar_receita` → `consultar_lentes` no mesmo turno → entrega 3 opções (DNZ / DMAX / HOYA) com valores + pergunta região no final.

### 6. Recuperação manual do Paulo Henrique

Atendimento `26464d89-d906-4b51-aad5-379ddf4131c8` ficou parado às 15:58 com a IA pedindo "conta mais detalhes". Disparar manualmente:

a. Mensagem de desculpa + retomada via template (atendimento já está fora de risco da janela 24h, ainda dentro):
   > "Paulo, desculpa a demora! Aqui estão as opções pra sua receita (OD -2.00 / OE -2.50): [3 opções]. Em Osasco centro temos a loja [endereço]. Quer agendar pra ver pessoalmente?"

b. Resetar `atendimentos.modo` para `ia` (já está) e marcar a coluna do pipeline como "Orçamento" para o cron de recuperação não interferir.

## Arquivos afetados

- `supabase/functions/ai-triage/index.ts` — alterar `detectForcedToolIntent`, relaxar `wantsQuote` no auto-chain pós-OCR, reforçar hint pós-receita.
- `ia_regras_proibidas` (insert via migration) — nova regra de comportamento.
- `ia_exemplos` (insert via migration) — novo exemplo `pos_receita_fluxo`.
- Mensagem manual de recuperação para o atendimento `26464d89`.
- Atualizar memória `mem://ia/auto-receita-e-anti-loop` documentando o caso Paulo + as duas falhas (auto-chain seletivo demais + escalada injustificada).

## Resultado esperado

Próxima vez que um cliente enviar receita comum:

```
Cliente → [foto da receita] + "queria um orçamento"
IA  → [interpretar_receita + consultar_lentes encadeados]
       "Sua receita: OD -2.00 / OE -2.50. Aqui as opções:
        1. DNZ HDI 1.59 antirreflexo — R$ X
        2. DMAX 1.60 BlueGuard — R$ Y
        3. HOYA Hi-Vision 1.67 — R$ Z
        Em qual região você está pra eu indicar a loja mais próxima?"
Cliente → "Osasco centro"
IA  → [responder com endereço da loja Osasco + sugerir agendamento]
```

Sem turno extra, sem escalada injustificada.
