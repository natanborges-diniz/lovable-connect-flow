# Fluxo LC pós-confirmação determinístico

## Problema
Marcelo confirmou receita ("Certo") e pediu "Lentes de contato a pronta entrega", mas o gate pós-confirmação em `ai-triage` exclui contextos LC (`if (!_isLCCtx && lastRx)`), delegando ao LLM. O LLM não chamou `consultar_lentes_contato`, o validador rejeitou a saída e caiu no pool genérico ("Conta pra mim com mais detalhes…"). Na repetição, o gate disparou de novo o ciclo de confirmação.

## Mudanças

### 1. Refatorar `runConsultarLentesContato` em helper reutilizável
Em `supabase/functions/ai-triage/index.ts` (~linhas 4887-5068), extrair a lógica inline da tool LC para uma função pura no escopo do módulo:

```ts
async function runConsultarLentesContato(
  supabase, contatoId, atendimentoId, args?
): Promise<{ resposta: string; usou_catalogo: boolean; needs_toric_sob_encomenda: boolean }>
```

Mantém: leitura da última receita salva, cálculo de combo 3+1, regra tórica obrigatória se cyl≥0.75 (sob encomenda), formatação da resposta.

### 2. Dispatch determinístico no gate pós-confirmação
Em `ai-triage/index.ts` (~linha 2816), remover a exclusão `_isLCCtx` e adicionar branch:

```
if (lastRx && receita_confirmada_agora) {
  if (_isLCCtx || regex_lc_pronta_entrega.test(contexto)) {
    const r = await runConsultarLentesContato(...)
    await sendWhatsApp(r.resposta)
    await registrarEvento('cotacao_lc_pos_confirmacao_forcada')
    return
  }
  // fluxo de óculos existente
}
```

Reforçar regex de detecção LC para incluir "pronta entrega", "lentes de contato", "LC".

### 3. Backfill manual — Marcelo
- Devolver atendimento `86b71001-…` para `modo=ia, status=aguardando`
- Disparar `runConsultarLentesContato` manualmente com a receita já confirmada (OD -1.75 CIL -0.25 EIXO 70°, OE -1.50 CIL -0.75 EIXO 10°)
- Enviar cotação via `send-whatsapp`
- Registrar evento `cotacao_lc_pos_confirmacao_backfill`

## Detalhes técnicos
- Sem migração de banco
- Sem mudanças em RLS ou edge functions além de `ai-triage`
- Helper preserva guardrails existentes (tom humano, validador estrutural)
- Idempotência: gate verifica se já existe `cotacao_lc_*` recente no atendimento antes de re-disparar

## Arquivos afetados
- `supabase/functions/ai-triage/index.ts` (refator + novo branch no gate)

## Memória
Adicionar memória `mem://ia/lc-pos-confirmacao-deterministica` documentando que LC pós-confirmação não passa mais pelo LLM.
