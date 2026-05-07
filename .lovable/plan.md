## Causa raiz

Na conversa, a Franciana digitou:

```
*OD*: ESF -13,50 *CIL -0,50 *EIXO 180°
*OE*: ESF -20,50 CIL -1,50 EIXO 145°
```

A IA persistiu OD como `ESF -13,50 / CIL -0,80 / EIXO 180°`. O `-0,80` é resíduo do OCR anterior — o parser **não capturou o cilindro novo (-0,50)**, então o merge manteve o valor antigo.

### Por quê (em `supabase/functions/ai-triage/index.ts`, função `detectPrescriptionCorrection`, linhas 644–740)

O Pattern A usa o regex:

```js
(od|oe|os)[^\d+\-]{0,15}${num}\s*(?:com|x|\/)?\s*${num}?\s*(?:eixo\s*${num})?
```

Entre a esfera (`-13,50`) e o cilindro (`-0,50`) o texto contém `" *cil "`. O regex só permite `\s*(?:com|x|\/)?\s*` antes do segundo `${num}`. Como há a palavra `cil` (e o `*`), o segundo grupo numérico **não casa** → `cylinder = null` → merge mantém o valor antigo (-0,80) do OCR.

OE funciona porque o cilindro vem direto após a esfera ou talvez já estava correto antes. Mas qualquer formato com a palavra "cil" entre os números reproduz o bug.

## Mudanças

### 1. `supabase/functions/ai-triage/index.ts` — Robustecer parser

a. **Pre-normalizar o texto** dentro de `detectPrescriptionCorrection` (após o tratamento de pl/plano/sc):
   - Remover asteriscos: `t = t.replace(/\*/g, " ")`.
   - Normalizar separadores explícitos: trocar palavras-rótulo por espaço, mas só entre números do mesmo olho — substituir ocorrências de `\b(esf[eé]rico|esf|cil[ií]ndrico|cil|cyl|eixo|axis|grau|graus)\b` por espaço **dentro do bloco de cada olho** (ver passo b). A palavra `eixo` precisa virar marcador especial para o axis, então fazemos isso só depois de extrair eixo (ou usamos um regex de eixo separado).

b. **Trocar Pattern A por extração por bloco de olho** (mais robusta):
   - Dividir `t` em blocos por olho usando lookahead em `od|oe|os`: regex `/\b(od|oe|os)\b([\s\S]*?)(?=\b(od|oe|os)\b|$)/gi`.
   - Em cada bloco:
     - Extrair `axis` primeiro: `/(?:eixo|axis)\s*([+-]?\d{1,3})/i`.
     - Extrair `add`: `/(?:add?|adi[cç][aã]o)\s*([+-]?\d+[.,]?\d*)/i`.
     - Remover esses trechos do bloco.
     - No restante, capturar **todos** os números (`/[+-]?\d+[.,]?\d*/g`) — primeiro = `sphere`, segundo = `cylinder`.
   - Isso elimina dependência de `com/x//` e ignora rótulos textuais como `esf`, `cil`, `*`, `:`, etc.

c. **Manter `parseDiopter` / `parseAxis` atuais** (shorthand óptico continua valendo).

d. **Validação anti-hallucination pós-merge** (linha ~3122 e ~2240): após aplicar o merge, comparar cada campo do `merged` com o texto-fonte normalizado:
   - Para cada valor não-null em `od.cylinder`, `oe.cylinder`, `od.sphere`, `oe.sphere`, `od.axis`, `oe.axis`: se o módulo do valor não aparece como substring numérica no texto original do cliente E o valor é diferente do snapshot da receita anterior, **reverter** ao valor anterior e logar `[RX-VALIDATE] revertendo {campo}: extracted={x} not found in source`.
   - Isso garante que mesmo se o parser falhar, nenhum número fantasma chega ao cliente.

### 2. Confirmação visível ao cliente

A mensagem `buildMsgConfirmarReceita` já mostra os 4 valores. Após este fix, o cilindro vai bater com o que o cliente digitou. Cliente responde "Não" → fluxo `[RX-CONFIRMACAO] Rejeição` continua repedindo (já existe).

### 3. Testes manuais (após deploy)

Re-disparar `ai-triage` para a conversa da Franciana via watchdog ou novo inbound. Esperar:
- `[RX-VALIDATE]` sem reversões.
- Mensagem de confirmação com `OD CIL -0,50` (não `-0,80`).
- Logs `[RX-HIGH-IMPACT]` mantêm-se (esfera ≥8 ainda dispara confirmação).

### 4. Memória

Atualizar `mem://ia/correcao-receita-por-texto` adicionando seção **"Parser por bloco de olho + validação anti-fantasma"** com a regra: todo número persistido tem que existir no texto-fonte.

## Fora de escopo
- OCR (Gemini Vision) — bug é só no parser de texto.
- Mudar copy ou fluxo de escalada.

## Validação
- Deploy `ai-triage`.
- Conferir nos logs: `[RX-VALIDATE]` ausente OU revertendo corretamente, e cilindro OD = -0,50 na próxima confirmação.