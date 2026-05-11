## O que aconteceu com a Beatriz

Sequência reconstruída (eventos_crm + mensagens):

1. **15:20** — cliente mandou foto da receita.
2. **15:21 / 15:22** — IA respondeu **duas vezes** a frase canned "Recebi sua receita 👀 Já estou analisando..." sem chamar `interpretar_receita` (eventos com `validator_flags=[no_tool_deterministic]`).
3. **15:28** — `watchdog-loop-ia` detectou o loop "analisando" e disparou a mensagem `MSG_PEDIR_RECEITA_TEXTO` ("Tô tendo dificuldade de ler os valores… me passa por texto"). Evento `loop_ia_resgate_pedindo_texto`.
4. **19:13** — cliente respondeu por texto:
   ```
   Olho direito: -4,25 Cilíndrico: -0,25 Eixo: 90°
   Olho esquerdo: -4,0 Cilíndrico: 0 Eixo:0
   ```
5. **19:13** — `ai-triage` registrou `loop_ia_detectado_pre_llm` (similaridade 100% entre as duas frases "Recebi sua receita…" repetidas em 15:21/15:22) e, sem `forcedIntent` claro, fez `loop_ia_escalado` → `atendimento.modo=humano` + mensagem fora do horário.

A receita **nunca foi interpretada** e nenhum orçamento foi gerado.

## Por que o gate de receita digitada falhou

`ai-triage/index.ts` tem um bypass do detector de loop:

```
if (loopCheck.detected && !correctionApplied) { … escala humano … }
```

O `correctionApplied` só fica `true` se `detectPrescriptionCorrection(lastInboundText)` retornar um objeto válido. No caso da Beatriz, retornou `null`.

Por que retornou `null` (parser em `detectPrescriptionCorrection`, linhas 707-835):

- O extrator percorre blocos via regex `/\b(od|oe|os)\b…/gi` — só casa as **abreviações** "OD"/"OE"/"OS".
- O texto da cliente usa **"Olho direito" / "Olho esquerdo"** (forma natural, inclusive sugerida pelo próprio prompt da IA: "OD (olho direito)").
- Resultado: nenhum bloco por olho é encontrado → `od.sphere` e `oe.sphere` ficam `null` → função retorna `null` na linha 829.
- O gate de markers passa (`cilíndrico` + `eixo` = 2 hits), mas como nada é extraído, cai fora.

Ou seja, o cliente respondeu **exatamente** o que a IA pediu, mas o parser não entende "Olho direito/esquerdo" — só "OD/OE". Sem prescription detectada, o loop detector pré-LLM venceu e escalou para humano.

## Correção proposta

Tornar `detectPrescriptionCorrection` tolerante a "Olho direito/esquerdo" (e variantes) sem afrouxar o anti-falso-positivo já existente.

**Arquivo:** `supabase/functions/ai-triage/index.ts`

1. **Normalização no início da função (após linha 718)** — antes dos markers e da extração por bloco, mapear as formas longas para os tokens curtos que o resto do parser já entende:

   ```
   t = t.replace(/\bolho\s+direito\b/g, "od");
   t = t.replace(/\bolho\s+esquerdo\b/g, "oe");
   // tolerância opcional a abreviações comuns
   t = t.replace(/\bo\.?d\.?\b/g, "od");
   t = t.replace(/\bo\.?e\.?\b/g, "oe");
   ```

   Isso faz `eyeBlockRe` casar normalmente, sem mexer no resto da lógica (validação anti-hallucination, parseDiopter, parseAxis, fallback longe/perto continuam idênticos).

2. **Manter intacto** o bloco do detector (linhas 3433-3464) — o `iaJustAskedForText` já casa com a mensagem do watchdog (regex bate em "tô tendo dificuldade de ler" e "me passar por texto"), então o ramo `client_typed_first` será disparado.

3. **Sanity check anti-hallucination** já cobre os números desse formato: "−4,25", "−0,25", "90", "0" todos aparecem no texto-fonte, então `validateField` mantém todos.

Não mexer no loop detector nem na escalada — o problema é só de leitura do texto.

## Verificação

- **Unit-style sanity:** rodar o detector mentalmente com o texto da Beatriz após a correção:
  - normaliza para `od: -4,25 cilíndrico: -0,25 eixo: 90 oe: -4,0 cilíndrico: 0 eixo:0`
  - blocos por olho extraem `od={sphere:-4.25, cylinder:-0.25, axis:90}` e `oe={sphere:-4.00, cylinder:0, axis:0}` ✓
  - `rx_type=single_vision`, sem add ✓
- **Reproducibilidade:** considerar variações "olho direito/OD", "OE — olho esquerdo", "olho dir/olho esq" — pelo menos as duas primeiras precisam funcionar; podemos adicionar `\bolho\s+dir\b` / `\bolho\s+esq\b` opcionalmente.
- Logs `[RX-VALIDATE]` permanecem para depuração.

## Impacto

- Casos antigos que já funcionavam (texto com "OD/OE") continuam idênticos.
- Casos novos com "Olho direito/esquerdo" passam a ser parseados, evitando que o loop detector + ausência de `correctionApplied` empurre o atendimento para humano.
- Sem alteração de banco, sem mudança de UI.
