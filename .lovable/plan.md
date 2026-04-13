

# Remover Colunas "Atendimento Humano" e "Redirecionado" — Fila Humana via Flag

## Contexto

As colunas "Atendimento Humano" (id: `6ed356cd-...`) e "Redirecionado" (id: `137630dc-...`) serão desativadas. A intervenção humana passa a ser gerenciada exclusivamente pela flag `atendimentos.modo = 'humano'`, com a Fila Humana (já implementada no Pipeline.tsx) como interface principal.

## Mudanças

### 1. Migração SQL — Desativar colunas e mover contatos órfãos

- `UPDATE pipeline_colunas SET ativo = false WHERE id IN ('6ed356cd-...', '137630dc-...')`
- Contatos que estejam nessas colunas → mover para "Novo Contato" ou "Retorno" (conforme ciclo_funil)
- Desativar automações vinculadas a essas colunas (`pipeline_automacoes`)

### 2. `supabase/functions/ai-triage/index.ts`

- Quando a IA escala para humano: **não mover para coluna "Atendimento Humano"**. Em vez disso, manter o contato na coluna atual e apenas setar `atendimentos.modo = 'humano'` (já faz isso parcialmente)
- Remover referência a `pipeline_coluna: "Atendimento Humano"` — a coluna pipeline fica inalterada
- Remover lógica de "Redirecionado" no prompt de localização — quando o cliente é irredutível sobre região, mover para "Perdidos" em vez de "Redirecionado"
- Atualizar busca de coluna que faz `find(c => c.nome === "Atendimento Humano")` → remover, pois o contato permanece na coluna onde está

### 3. `supabase/functions/vendas-recuperacao-cron/index.ts`

- Remover "Atendimento Humano" de `ELIGIBLE_COLUMNS` e `INACTIVITY_THRESHOLDS`
- Contatos com `modo = 'humano'` devem ser ignorados pela cadência automática (já que o humano está cuidando)

### 4. `supabase/functions/whatsapp-webhook/index.ts`

- Remover "Redirecionado" da lista de colunas terminais que acionam retorno (`["Abandonado", "Cancelado", "Perdidos", "Redirecionado"]` → remover "Redirecionado")

### 5. `src/pages/Pipeline.tsx`

- Remover função `isAtendimentoHumano` e referências visuais específicas à coluna (linhas 237-238, 396, 466-470)
- Adicionar destaque visual nos cards do Kanban que têm `modo = 'humano'`: borda vermelha pulsante + ícone de alerta — independente de qual coluna estejam
- A Fila Humana (linhas 328-381) já funciona corretamente baseada em `modo === "humano"` — manter como está

## Resultado

- Colunas desativadas no banco (não aparecem no Kanban)
- IA escalona setando `modo = 'humano'` sem mover o card
- Operador vê cards sinalizados na Fila Humana + destaque visual em qualquer coluna
- Nenhum contato fica órfão

