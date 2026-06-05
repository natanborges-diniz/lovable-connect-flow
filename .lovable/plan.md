
# Visão Monocular — Detecção e Cotação Pela Metade

## Problema observado (conversa Thaires)
- Cliente disse "Olho direito sem visao", "Tenho visão monocula" — IA repetiu 3× "Li sua receita assim, confere? OD (não consegui ler)" e acabou escalando.
- Cotação inexistente para esse perfil: o orçamento de monocular é **metade do preço de tabela** (uma lente só).

## Causa raíz
1. `detectPrescriptionCorrection` não reconhece "monocular" / "sem visão em OX" como informação válida → fica eternamente esperando o esférico do OD.
2. `buildMsgConfirmarReceita` mostra `(não consegui ler)` para o olho faltante mesmo quando o cliente já declarou que não há lente.
3. `runConsultarLentes` / `runConsultarLentesContato` / `buscar-lentes-operador` sempre cotam par (price_brl). Não existe modificador `÷2`.

## Plano

### 1. Detecção (ai-triage)
Adicionar helper `detectMonocular(text)` antes do bloco de correção textual (lá pelas linhas 4960). Regex cobre:
- `monocul[ao]r?`
- `(s[oó]\s+enxergo|enxergo s[oó]|s[oó]\s+vejo|vejo s[oó])\s+(do|com|pelo)?\s*(olho)?\s*(direito|esquerdo|od|oe)`
- `(olho)?\s*(direito|esquerdo|od|oe)\s+(sem\s+vis[aã]o|n[ãa]o\s+enxergo|n[ãa]o\s+vejo|cego|protese|pr[oó]tese|tampado)`
- `uma?\s+lente\s+(s[oó]|apenas)`

Devolve `{ blind_eye: 'od' | 'oe' | null }`. Quando ambíguo (só "monocular" sem lado), pergunta UMA vez: "Qual olho você usa, OD (direito) ou OE (esquerdo)?".

### 2. Persistência
Quando detectado, gravar em `contato.metadata.receita_monocular = { eye_used: 'oe', set_at, source: 'client_typed' }` **e** marcar a receita corrente:
- `rx.monocular = true`
- `rx.eye_used = 'oe'`
- Para o olho cego, salvar `{ blind: true }` no slot (sem esfera/cilindro).

Isso desbloqueia o gate de confirmação (`fmtRxLine` passa a renderizar "👁️ *OD*: _visão monocular (sem lente)_" em vez de "(não consegui ler)"; missing[] não inclui esse olho).

### 3. Confirmação visual
Atualizar `buildMsgConfirmarReceita`:
```
Li sua receita assim, confere? 😊
👁️ *OD*: _visão monocular (sem lente)_
👁️ *OE*: ESF -0,75 CIL -0,25 EIXO 25°

Está certinho?
```

### 4. Cotação — óculos (`runConsultarLentes`, `runConsultarLentesEstimativa`)
Quando `rx.monocular === true`:
- Usar só os valores do olho ativo para filtrar catálogo (já é o que o código faz quando só um olho tem grau, mas confirmar).
- Multiplicar `price_brl` por `0.5` em **todas** as faixas exibidas (eco/inter/prem) e nas alternativas.
- Adicionar nota no cabeçalho da mensagem: `_💡 Valores já considerando apenas 1 lente (visão monocular)._`
- Manter ordenação/anti-inversão como hoje (proporção preserva ordem).

### 5. Cotação — lentes de contato (`runConsultarLentesContato`)
- Reduz `caixasTotal` para `caixasPorOlhoAno` (1 olho, não 2).
- Recalcula `total_ano` com o novo número de caixas (combo 3+1 mantém regra).
- Texto: `Plano anual (1 olho): ~R$ X (Y cx)` em vez de "(2 olhos)".

### 6. Copiloto do operador (`buscar-lentes-operador`)
- Aceitar `body.monocular?: boolean` (sobrepõe receita).
- `BuscarLentesSheet`: checkbox "Visão monocular (cota 1 lente / metade do preço)" no painel de receita. Quando marcado, envia `monocular=true`.
- EF aplica mesma lógica de ÷2 (óculos) e 1 olho (LC).
- Mensagem formatada inclui a nota da metade.

### 7. Guardrails anti-loop
- Em `ai-triage`, quando `rx.monocular === true` e único olho ativo está completo (esférico definido), **bloquear** novo pedido "me passa por texto" e re-disparo de `buildMsgConfirmarReceita` repetidamente (já existe contador `≥3 confirmações em 60min` → escalar; adicionar bypass para confirmar de imediato e seguir para cotação).

### 8. Memória de projeto
Criar `mem://ia/visao-monocular` resumindo: detecção, half-price, 1 caixa LC, flag persistida em contato.

## Out of scope
- Não criar coluna `is_monocular` em `pricing_table_lentes` (cálculo é puramente runtime).
- Não alterar templates WhatsApp.
- Não tocar em `interpretar_receita` (OCR continua tentando ler; monocular vem do texto do cliente).

## Arquivos afetados
- `supabase/functions/ai-triage/index.ts` (detecção, persistência, confirmação, cotações óculos+LC, guardrail).
- `supabase/functions/buscar-lentes-operador/index.ts` (param `monocular`, ÷2 óculos, 1 olho LC).
- `src/components/atendimentos/BuscarLentesSheet.tsx` (checkbox monocular).
- Memória nova: `.lovable/memory/ia/visao-monocular.md` + entrada no index.

## Validação
- Re-simular conversa Thaires: cliente diz "olho direito sem visão" → IA confirma "👁️ OD: visão monocular (sem lente) / OE: ESF -0,75 …", cliente "Sim" → IA cota Eco/Inter/Prem com preços /2 e oferece visita.
- Copiloto: marcar checkbox → mensagem ao cliente sai com nota da metade e valores corretos.
