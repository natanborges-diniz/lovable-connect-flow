---
name: Copiloto Cotação Operador
description: Painel humano de busca de lentes no chat (BuscarLentesSheet + EF buscar-lentes-operador), tom Gael, nunca escreve
type: feature
---

# Copiloto de Cotação de Lentes (humano)

Painel paralelo ao fluxo automático da IA. Disponível em **todo** atendimento aberto via botão "🔍 Buscar lentes" no header (ao lado da modo badge), independente do modo (IA / humano / ponte).

## Princípio inviolável
- **Não altera o comportamento da IA.** `runConsultarLentes`, `runConsultarLentesEstimativa`, `runConsultarLentesContato` em `supabase/functions/ai-triage/index.ts` continuam intactos.
- A EF `buscar-lentes-operador` reimplementa a lógica de 3 faixas (eco/inter/prem) e validador anti-inversão de forma standalone — mesma regra, código separado, zero risco de regressão.

## Componentes
- **Edge function:** `supabase/functions/buscar-lentes-operador/index.ts` — `verify_jwt=true` em código (valida via `supabase.auth.getUser`). Read-only sobre `pricing_table_lentes` / `pricing_lentes_contato`. Aceita `{ atendimento_id, modo, query_natural?, filtros?, receita_override? }`. Modo: `oculos | lc | estimativa | catalogo_livre`. Devolve `{ faixas, alternativas, mensagem_formatada_cliente, debug }`. **Nunca insere mensagem, nunca toca em `metadata`, nunca dispara evento.**
- **NL → filtros:** quando `query_natural` vem preenchido, chama Lovable AI Gateway (`google/gemini-3-flash-preview`, temp 0) só para extrair `{ preferencia_marca, filtro_blue, filtro_photo, material_policarbonato, descarte, is_toric, preco_max }`. Filtros explícitos do form sobrepõem o NL.
- **UI:** `src/components/atendimentos/BuscarLentesSheet.tsx` — Sheet lateral com 3 abas (Óculos / LC / Catálogo). Receita pré-carrega de `atendimento.metadata.receitas[ultimo]` (fallback contato.metadata) e fica editável inline como override (não persiste). Botões `Copiar` e `Inserir no campo de envio` (escreve no `msgText` via `onInsertComposer`; operador revisa e envia normalmente — sem auto-envio).
- **Integração:** `src/pages/Atendimentos.tsx` monta o Sheet dentro de `AtendimentoDetail` e adiciona botão no header badge bar.

## Linguagem
Mensagem final replica o formato Gael / Óticas Diniz:
- Óculos: `🔍 *Opções de lentes para o seu grau:* OD …/… | OE …/… [| Ad: +X]` + 🟢🟡💎 com `*Marca Família* índice tratamento — *R$ x*` + CTA "Quer que eu agende uma visita…".
- LC: `👁️ *Lentes de contato — opções:*` com cálculo de combo 3+1 e plano anual por 2 olhos.
- `brandDisplay` normaliza HOYA/DNZ/DMAX/ZEISS em caixa alta; demais Title Case.

## Permissões
- EF protegida por JWT autenticado; qualquer operador logado usa.
- Sem novas tabelas, sem migrations, sem novas policies.
