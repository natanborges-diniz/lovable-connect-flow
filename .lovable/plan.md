## Objetivo

Após 2 tentativas frustradas de confirmação de receita (cliente diz "Não" / corrige e ainda continua errada), IA admite a dificuldade de leitura e escala para Consultor humano em vez de continuar repetindo o ciclo "Anotei! ✅ → Não → me passa por texto".

## Estado atual

`supabase/functions/ai-triage/index.ts` ~2374–2405 — ramo `detectRxRejeicao`:

```ts
const newCount = correctionCount + 1;
// ... incrementa metadata.receita_confirmacao.correction_count ...
let respRej: string;
if (newCount >= 2) {
  respRej = MSG_PEDIR_RECEITA_TEXTO;          // ← apenas re-pede texto
} else {
  respRej = lastRx ? buildMsgConfirmarReceita(lastRx, true) + … : "...";
}
await sendWhatsApp(...);
return { precisa_humano: false, ... };
```

`correction_count` também sobe em ~3353 quando há correção textual de alto impacto que dispara nova confirmação. Hoje nada lê esse contador para escalar.

## Mudanças

### 1. Escalada quando `correction_count >= 2`

`ai-triage/index.ts` ~2395–2405: substituir o ramo `if (newCount >= 2)` por:

- Limpar `metadata.receita_confirmacao.pending` (consultor assume daqui).
- Setar `atendimentos.metadata.revisao_humana_pendente = true` com `revisao_motivo = "receita_confirmacao_falhou_2x"` e `revisao_solicitada_at = now()`.
- Trocar modo do atendimento para `humano` (mesmo padrão usado em `MSG_ESCALADA_GRAU_FORA_FAIXA` / outros pontos de escalada já existentes — reutilizar helper de escalada se houver, senão replicar update de `atendimentos`).
- Mensagem ao cliente (sucinta, padrão Gael):

  > "Desculpa, tô com dificuldade de bater os valores da sua receita certinho 😅 Vou te encaminhar pra um *Consultor humano* que vai conferir junto com você. Já avisei o time aqui."

- Aplicar suffix de horário comercial igual às outras escaladas (fora do expediente, anexa próxima abertura). Reutilizar `buildHorarioSuffix` / similar já presente no arquivo.
- Gravar evento `receita_escalada_apos_2_rejeicoes` em `eventos_crm` com metadata `{ correction_count, rx_label, last_rx_values }`.
- Retornar `{ precisa_humano: true, tools_used: ["receita_escalada_humano"], pipeline_coluna_sugerida: <coluna humana padrão> }`.

### 2. Mesma lógica no caminho de correção textual

`ai-triage/index.ts` ~3344–3382: depois de incrementar `correction_count` no `receita_confirmacao` da correção de alto impacto, antes de enviar `buildMsgConfirmarReceita(merged, true)`, checar:

```ts
if (Number(newMeta.receita_confirmacao.correction_count) >= 3) {
  // já houve 2 correções anteriores que continuaram divergindo → escala
  ...
}
```

Threshold = 3 nesse ponto porque a 1ª correção é o estado normal; a partir da 3ª correção textual em sequência (sem confirmação intermediária), tratamos como dificuldade de leitura e escalamos com a mesma mensagem do passo 1.

> Observação: contador é compartilhado, então qualquer combinação de "rejeições + correções" que somem ≥2 já dispara o ramo do passo 1. Aqui é só para o caso degenerado em que o cliente fica enviando texto novo sem nunca passar pelo gate de confirmação.

### 3. Reset do contador

Quando cliente confirma com sucesso (ramo `detectRxConfirmation` ~2237 que zera `pending`), zerar também `correction_count`. Garante que o contador não acumula entre receitas diferentes do mesmo contato.

### 4. Validação pós-deploy

Curl `ai-triage` simulando:
1. Foto de receita → IA pede confirmação.
2. Inbound "Não" → `correction_count=1`, IA repede.
3. Inbound "Não" de novo → `correction_count=2`, esperado: mensagem de admissão + escalada humana, evento `receita_escalada_apos_2_rejeicoes`, `revisao_humana_pendente=true`.

Query auditoria:
```sql
SELECT contato_id, count(*) FROM eventos_crm
WHERE tipo='receita_rejeitada_cliente' AND created_at > now() - interval '7 days'
GROUP BY contato_id HAVING count(*) >= 2;
```
→ todos os IDs aqui devem ter um `receita_escalada_apos_2_rejeicoes` correspondente.

### 5. Memory

Atualizar `mem://ia/correcao-receita-por-texto` com nova seção:

> **Escalada após 2 falhas de confirmação:** quando `correction_count >= 2` no ramo de rejeição (ou ≥3 no ramo de correção textual de alto impacto), IA admite dificuldade de leitura e escala para Consultor (`revisao_humana_pendente=true`, modo=humano, evento `receita_escalada_apos_2_rejeicoes`). Mensagem fixa, com suffix de horário comercial. Contador zera ao confirmar.

## Fora de escopo

- Herança de sinal no parser textual (problema de "+7,50" vs "-7,50") — fica para um plano separado.
- Threshold `isHighImpact` (Δ≥0,75 / |sph|>10) — mantém.
- Frontend e popover — sem mudança.
- Lentes de contato — sem mudança.

## Arquivos

- `supabase/functions/ai-triage/index.ts` (ramo rejeição ~2395–2405; ramo correção textual ~3344–3382; ramo confirmação ~2237 para zerar contador).
- `.lovable/memory/ia/correcao-receita-por-texto.md`.
