

# Plano: Tabela de Preços de Lentes + Aprimoramento da Tool interpretar_receita + Quote Engine

## Objetivo

Criar a tabela `pricing_table_lentes` no banco, carregar os dados iniciais, aprimorar a tool `interpretar_receita` para seguir o contrato padronizado, e implementar o quote engine que busca lentes compatíveis automaticamente após a interpretação da receita.

## Arquitetura do Fluxo

```text
Cliente envia foto receita
        │
        ▼
  ai-triage (GPT-5 Vision)
  tool: interpretar_receita
  saída: JSON rx padronizado
        │
        ▼
  quote_engine (lógica no ai-triage)
  SELECT * FROM pricing_table_lentes
  WHERE category = rx_type
    AND sphere_min <= esf <= sphere_max
    AND cylinder_min <= cil <= cylinder_max
    AND (add_min <= add <= add_max)
  ORDER BY priority, price_brl
        │
        ▼
  Monta resposta com top 3 opções
  (econômica, intermediária, premium)
  e envia ao cliente
```

## Etapas

### 1. Migração: Criar tabela `pricing_table_lentes`

Criar a tabela conforme a estrutura fornecida. RLS: leitura para `anon` e `authenticated`, gestão completa para `authenticated`.

### 2. Carga inicial de dados

Inserir os 30 registros de lentes HOYA, DNZ e ZEISS via insert tool.

### 3. Atualizar tool `interpretar_receita` no ai-triage

Substituir a definição atual da tool por uma versão que segue o contrato padronizado:
- Saída estruturada com `eyes.od`, `eyes.oe`, `pd`, `rx_type`, `summary`, `confidence`, `needs_human_review`
- Após o GPT retornar a extração, o código do ai-triage faz a pós-classificação determinística (has_addition → progressive, etc.)
- Se `confidence < 0.80` → `needs_human_review = true` → resposta cautelosa + escalar

### 4. Implementar quote engine no handler do ai-triage

Após `interpretar_receita` retornar dados válidos:
1. Query `pricing_table_lentes` filtrando por `category`, ranges de sphere/cylinder/add, `active = true`
2. Ordenar por `priority ASC, price_brl ASC`
3. Selecionar top 3 opções (econômica, intermediária, premium)
4. Montar resposta formatada para WhatsApp com marca, família, tratamento e preço
5. Se nenhuma lente compatível: escalar para consultor

### 5. Atualizar armazenamento de dados da receita

Salvar no `contatos.metadata.ultima_receita` o formato padronizado (eyes.od/oe com sphere/cylinder/axis/add, rx_type, confidence).

## Arquivos a modificar

| Arquivo | Ação |
|---------|------|
| Migração SQL | Criar tabela `pricing_table_lentes` + RLS |
| Insert SQL | Carga dos 30 registros iniciais |
| `supabase/functions/ai-triage/index.ts` | Atualizar tool interpretar_receita + adicionar quote engine |

## Detalhes Técnicos

### Tool interpretar_receita (novo contrato)

A tool definition no GPT passará a pedir o formato padronizado com `eyes.od.sphere`, `eyes.od.cylinder`, etc. como números (não strings). O handler pós-tool-call fará:

```text
1. Parse dos valores numéricos
2. Classificação determinística do rx_type
3. Cálculo de confidence baseado em campos preenchidos
4. Se confidence >= 0.80: query pricing_table_lentes
5. Se confidence < 0.80: resposta cautelosa + needs_human_review
```

### Query do Quote Engine

```sql
SELECT * FROM pricing_table_lentes
WHERE active = true
  AND category = $rx_type
  AND sphere_min <= $worst_sphere AND sphere_max >= $worst_sphere
  AND cylinder_min <= $worst_cylinder AND cylinder_max >= $worst_cylinder
  AND (
    ($rx_type != 'progressive') OR
    (add_min <= $max_add AND add_max >= $max_add)
  )
ORDER BY priority ASC, price_brl ASC
```

A resposta ao cliente segue o formato:
- Opção econômica (menor priority + menor preço)
- Opção intermediária
- Opção premium (maior preço)
- Cada opção: marca, família, tratamento, índice, preço

### Registros com price_brl = 0

Os registros DNZ HD, DNZ HDI e DNZ Free Form têm preço 0. Serão inseridos mas filtrados na query (`price_brl > 0`) até que os preços sejam atualizados.

