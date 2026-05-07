
## Diagnóstico real

A Thaynara (atendimento `46d5579a-8a56-44a7-a888-b815ca923e11`) confirmou a receita e o `ai-triage` caiu no ramo `fora_da_faixa === true` (linha 2257), enviou `MSG_ESCALADA_GRAU_FORA_FAIXA` ("lente especial, vou te conectar com Consultor") e fez `modo='humano'`. **Esse caminho NÃO seta `revisao_humana_pendente`** — só o caminho de cotação automática (`consultar_lentes`, linha 5404→5447) seta.

Resultado: atendimentos escalados por receita fora-da-faixa ficam em modo humano sem o popover de validação aparecer. O operador não tem onde validar a leitura antes de cotar manualmente.

## Mudanças

### 1. Forçar a flag no atendimento da Thaynara (one-shot)

Migração `UPDATE atendimentos` setando em `metadata`:
- `revisao_humana_pendente = true`
- `revisao_motivos = ['cilindrico_alto:5.5', 'escalada_grau_fora_faixa']`
- `revisao_solicitada_at = now()`

Filtro: `id = '46d5579a-8a56-44a7-a888-b815ca923e11'`. Assim o botão **📄 Receita lida** aparece imediatamente para você testar o fluxo de validação.

### 2. Corrigir gap em `ai-triage` (escalada fora-da-faixa)

Em `supabase/functions/ai-triage/index.ts`, no bloco da escalada `foraDaFaixa` (linhas 2257-2278), antes do `return jsonResponse(...)`, gravar também a flag de revisão humana no atendimento:

```ts
// Marca flag para o popover "Receita lida" aparecer no detalhe
const motivos: string[] = ["escalada_grau_fora_faixa"];
const cyl = Math.max(
  Math.abs(Number(lastRx?.eyes?.od?.cylinder) || 0),
  Math.abs(Number(lastRx?.eyes?.oe?.cylinder) || 0)
);
const sph = Math.max(
  Math.abs(Number(lastRx?.eyes?.od?.sphere) || 0),
  Math.abs(Number(lastRx?.eyes?.oe?.sphere) || 0)
);
if (cyl > 4) motivos.push(`cilindrico_alto:${cyl}`);
if (sph > 10) motivos.push(`esferico_fora_catalogo:${sph}`);

const { data: atFlag } = await supabase
  .from("atendimentos").select("metadata").eq("id", atendimento_id).single();
const metaFlag = (atFlag?.metadata as Record<string, any>) || {};
await supabase.from("atendimentos").update({
  modo: "humano",
  metadata: {
    ...metaFlag,
    revisao_humana_pendente: true,
    revisao_motivos: motivos,
    revisao_solicitada_at: new Date().toISOString(),
  },
}).eq("id", atendimento_id);
```

Substitui o `update({ modo: "humano" })` puro da linha 2261. A partir daí, **todo lead escalado por fora-da-faixa** já entra com a flag ligada e o popover aparece para o consultor validar a leitura antes de cotar manualmente.

### 3. Memória

Atualizar `mem://ia/regras-negocio-e-proibicoes-criticas`: gate do popover **📄 Receita lida** cobre dois caminhos — (a) cotação automática com `cilindrico_alto`/`adicao_alta`/`esferico_faixa_cinza`; (b) escalada por `fora_da_faixa` (cyl/sph fora do catálogo cotável).

## Arquivos

- Migração SQL — UPDATE pontual no atendimento da Thaynara.
- `supabase/functions/ai-triage/index.ts` (linhas ~2261) — flag no ramo `foraDaFaixa`.
- `mem://ia/regras-negocio-e-proibicoes-criticas` — escopo do popover.

## Sem mudanças

- UI / popover (`ReceitaValidacaoPopover.tsx`) já funciona corretamente — só não estava recebendo o flag nesse caminho.
- `interpretar_receita`, schema, frontend.
