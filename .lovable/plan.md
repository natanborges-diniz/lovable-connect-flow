## O que aconteceu agora (Artur, 16:40)

Cliente disse claramente: **"Quero reservar Acuvue"**.
A IA respondeu confirmando a marca, mas voltou ao script antigo:

> "Posso te receber na Diniz Carapicuíba… **para finalizar e tirar as medidas**. Qual dia e horário você prefere?"

Dois erros ao mesmo tempo:
1. **Pediu para o cliente ir à loja tirar medidas** — lente de contato **não exige visita** para isso.
2. **Não encaminhou para humano** fechar a venda — caiu de novo no fluxo de `agendar_visita`.

## Regra de negócio (memória nova)

Para **lentes de contato**:
- A receita já foi enviada digitalmente (foto).
- **Não há necessidade de o cliente ir à loja para "tirar medidas".**
- Após escolher a lente, o cliente vai direto para **fechamento com humano**, e **na hora do fechamento ele escolhe qual ótica vai retirar o pedido**.
- Visita à loja **só** entra em cena para **óculos de grau** (ajuste de armação, DNP, altura, etc.).

Isso vira regra dura no prompt e em memória (`mem://ia/lentes-de-contato-orcamento` e novo `mem://ia/fechamento-lc-sem-visita`).

## Correção (atualiza o plano anterior)

### 1. Intent determinístico `fechamento_lc`

Em `supabase/functions/ai-triage/index.ts`, expandir `detectForcedToolIntent` para reconhecer, **em contexto LC com receita salva e opções já apresentadas**:
- "quero reservar", "quero fechar", "vou querer", "fica com a X", "pode reservar", "quero pedir", "quero essa"
- nome de marca isolado (Acuvue, Biofinity, Solflex, DNZ, Air Optix, Oasys, etc.)
- combinações ("quero reservar Acuvue", "vou de Biofinity")

→ marcar intent como **`fechamento_lc`**.

### 2. Bloqueio absoluto de `agendar_visita` para LC

Guardrail novo: se o item em pauta é **lente de contato**, a IA **não pode**:
- chamar `agendar_visita`
- pedir dia/horário para ir à loja
- usar as palavras "tirar medidas", "vir até a loja para finalizar", "agendamento na loja" no contexto de LC

Se o modelo tentar, o validador derruba a resposta e força o fluxo de **fechamento com humano**.

### 3. Encaminhamento direto para HUMANO (sem visita)

Quando intent = `fechamento_lc`:

1. Echo curto da escolha:
   *"Perfeito, Artur — reservando a Acuvue Oasys para Astigmatismo 👌"*
2. Reforço da regra de encomenda:
   *"Por ser tórica é sob encomenda; o pagamento confirma a reserva."*
3. Avisar que o **Consultor humano dá continuidade** e que **a ótica de retirada será escolhida no fechamento**:
   *"Vou te passar agora para um Consultor da nossa equipe finalizar o pedido — com ele você escolhe em qual loja prefere retirar e recebe o link de pagamento. Em instantes ele te chama por aqui mesmo 🤝"*
4. Server-side dispara:
   - `escalar_consultor` com `motivo = 'fechamento_lentes_contato'`
   - `atendimentos.modo = 'humano'`
   - move card no pipeline para a coluna de **fechamento** (CRM)
   - `eventos_crm` tipo `fechamento_lc_escalado` com metadata: marca, descarte, preço, OD/OE, região (se houver)
5. **Não** pergunta loja, **não** pergunta data, **não** pergunta horário.

### 4. Prompt: novo bloco obrigatório

Adicionar ao system prompt do `ai-triage`:

```
[FLUXO LENTES DE CONTATO — FECHAMENTO]
- LC NUNCA exige visita à loja para "tirar medidas". A receita do cliente já basta.
- Quando o cliente escolher uma marca/modelo OU disser "quero reservar/fechar/pedir":
  1. Confirme a escolha em uma frase.
  2. Se for tórica/multifocal, lembre que é sob encomenda e que o pagamento confirma a reserva.
  3. Encaminhe para um Consultor humano finalizar (a loja de retirada é escolhida no fechamento, não agora).
  4. NÃO pergunte dia/horário, NÃO ofereça visita, NÃO use "tirar medidas".
```

### 5. Validador (anti-regressão)

Se a resposta candidata, **em contexto LC**, contiver qualquer um destes padrões, é rejeitada e substituída pelo fluxo de fechamento:
- "tirar medidas"
- "vir até a loja"
- "qual dia/horário"
- "posso te receber na"
- chamada a `agendar_visita`

### 6. Memória

- **Novo** `mem://ia/fechamento-lc-sem-visita`:
  > Lentes de contato não requerem visita à loja. Após escolha de marca/modelo ou pedido de reserva, IA encaminha direto para Consultor humano fechar a venda; a ótica de retirada é decidida no fechamento.
- **Atualizar** `mem://ia/lentes-de-contato-orcamento` com a regressão "Artur 16:40" (IA chamou para loja tirar medidas).
- Atualizar `mem://index.md` com regra Core curta:
  > LC: nunca agendar visita nem falar em "tirar medidas". Após escolha → escalar para humano fechar; loja de retirada é definida no fechamento.

## Arquivos afetados

- `supabase/functions/ai-triage/index.ts`
- `.lovable/memory/ia/lentes-de-contato-orcamento.md`
- `.lovable/memory/ia/fechamento-lc-sem-visita.md` (novo)
- `.lovable/memory/index.md`

## Validação (casos de teste)

1. **"Quero reservar Acuvue"** após orçamento → confirma marca + escala humano. **Não** pede dia/hora.
2. **"Acuvue"** isolado em contexto de orçamento LC → idem.
3. **"Quero reservar"** sem marca em contexto LC → confirma item sugerido + escala humano.
4. **"Quero agendar"** para **óculos de grau** → continua usando `agendar_visita` normalmente (regra LC não afeta grau).
5. Modelo tentando responder "posso te receber na Diniz para tirar medidas" em contexto LC → validador rejeita, força fechamento.
