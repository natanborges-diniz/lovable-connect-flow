## Diagnóstico

No caso Natan (15/05 21:50), o cliente enviou a receita completa digitada na **primeira mensagem**, sem que a IA tivesse pedido antes por texto. No `ai-triage/index.ts` linha 4302-4308:

```ts
const iaJustAskedForText = (recentOutbound || []).slice(-2).some(...MSG_PEDIR_RECEITA_TEXTO...);
const isFirst = receitas.length === 0;
if (isFirst && !iaJustAskedForText) {
  console.log(`[RX-FIRST-TYPED] Skipped: no prior request from IA`);
}
```

Como `isFirst=true` e `iaJustAskedForText=false`, o parser foi **pulado**. O LLM então viu apenas texto inbound sem receita salva e pediu a foto da receita — comportamento padrão.

A "linha 4218 com hasStrongRxSignal" mencionada no resumo do contexto anterior **não existe no arquivo**. A correção nunca foi de fato implementada — só o deploy foi feito.

## Plano

Modificar o gate em `ai-triage/index.ts` (~linha 4300-4308) para aceitar receita digitada espontaneamente quando o parser devolve **sinal forte**:

1. Computar `hasStrongRxSignal` a partir do retorno de `detectPrescriptionCorrection`:
   - `od.sphere != null` **E** `oe.sphere != null` (ambos olhos com esfera) **E**
   - pelo menos um dos olhos com `cylinder` OU `axis` definido **OU** `has_addition === true`.
2. Trocar a condição do skip para `if (isFirst && !iaJustAskedForText && !hasStrongRxSignal)`. Assim:
   - Padrão isolado tipo "od -2.50" (sem oe, sem cil/eixo) continua sendo ignorado (anti falso positivo).
   - Receita estruturada completa (OD esf+cil+eixo, OE esf+cil+eixo, com ou sem adição) é aceita imediatamente.
3. Logar `[RX-FIRST-TYPED] Accepted via strong signal` para auditoria.
4. Quando aceita por strong signal, manter o restante do fluxo já existente: marca `source="client_typed_first"`, `confidence=0.99`, e segue para `consultar_lentes` (ou `consultar_lentes_estimativa` se faltar ADD num pedido multifocal — já coberto pela memória `orcamento-multifocal-parcial`).
5. Deploy de `ai-triage` e verificação pelos logs `[RX-FIRST-TYPED] Accepted via strong signal` na próxima invocação.
6. Atualizar `mem://ia/correcao-receita-por-texto.md` registrando o caso Natan + a nova regra de `hasStrongRxSignal`.

## Fora de escopo

- Nenhuma mudança em `vendas-recuperacao-cron`, watchdogs, ou no flow de orçamento em si.
- Não alterar `detectPrescriptionCorrection` (parser já funciona; só o gate de aceitação muda).