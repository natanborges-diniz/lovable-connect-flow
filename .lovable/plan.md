

## Plano: Todo Contato Entra no CRM — Roteamento Inteligente por Tipo e Histórico

### Problema Atual

- Contatos só entram no pipeline CRM após 3+ mensagens inbound (linha 994 do `ai-triage`)
- Contatos novos ficam sem `pipeline_coluna_id` e não aparecem no Kanban
- Contatos que retornam após abandono entram como se fossem novos
- Lojas/colaboradores não são direcionados ao pipeline interno automaticamente

### Solução: Roteamento em Duas Camadas

#### Camada 1 — No webhook (imediato, ao criar atendimento)

Quando um novo atendimento é criado (linhas 123-161 do `whatsapp-webhook`), atribuir `pipeline_coluna_id` ao contato imediatamente:

```text
SE contato.tipo = "loja" ou "colaborador"
  → Pipeline interno (coluna "Novo" do setor interno)
  → Bot de lojas já é acionado normalmente

SE contato NÃO tem pipeline_coluna_id (nunca entrou no CRM)
  → Coluna "Novo Contato" do pipeline de vendas

SE contato TEM pipeline_coluna_id
  SE coluna atual = "Abandonado" ou "Cancelado" (colunas terminais)
    → Mover para coluna "Retorno" (nova coluna)
  SENÃO
    → Manter na coluna atual (continua a jornada)
```

#### Camada 2 — Na triagem IA (progressão com maturidade)

Remover a restrição `inboundCount >= 3` na linha 994. A IA já sugere a coluna correta — a barreira de 3 mensagens atrasa a classificação desnecessariamente. Como o contato já está no CRM desde a primeira mensagem (Camada 1), a IA só precisa **mover** quando tem certeza da intenção.

Nova lógica (linha 994):
```text
// Antes: inboundCount >= 3 || pipeline_coluna !== "Novo Contato"
// Depois: pipeline_coluna !== "Novo Contato" (sempre move se a IA sugere coluna específica)
```

### Nova Coluna: "Retorno"

Criar coluna "Retorno" no pipeline de vendas, posicionada após "Novo Contato". Serve para contatos que já passaram pelo funil (foram abandonados/cancelados) e voltaram a entrar em contato. Permite ao operador ver que é um cliente conhecido que retornou.

### Arquivos Alterados

**1. `supabase/functions/whatsapp-webhook/index.ts`**
- Após criar novo atendimento (linha ~150), adicionar lógica de atribuição de `pipeline_coluna_id`:
  - Buscar colunas do pipeline
  - Verificar tipo do contato (loja/colaborador → pipeline interno)
  - Verificar se contato já tem coluna (terminal → "Retorno", sem coluna → "Novo Contato")
  - Atualizar contato com a coluna

**2. `supabase/functions/ai-triage/index.ts`**
- Linha 994: Remover condição `inboundCount >= 3` — mover contato sempre que a IA sugere coluna diferente de "Novo Contato"

**3. Migração SQL**
- Criar coluna "Retorno" no pipeline de vendas (se não existir)

### Fluxo Visual

```text
WhatsApp msg → webhook
  ├─ Contato tipo loja/colaborador → Pipeline Interno + Bot
  ├─ Contato novo (sem coluna) → "Novo Contato" no CRM
  ├─ Contato retornando (Abandonado/Cancelado) → "Retorno" no CRM
  └─ Contato ativo (já tem coluna válida) → Mantém posição
      │
      └─ IA classifica → Move para coluna adequada quando tem certeza
```

### Resultado

- Todo atendimento WhatsApp aparece no CRM desde a primeira mensagem
- Lojas e corporativos vão direto pro pipeline interno
- Clientes que retornam são identificados como "Retorno", não como leads novos
- IA continua fazendo a progressão do card conforme a conversa evolui

