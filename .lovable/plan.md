

# Correção: Integrar categorias ESSILOR no Quote Engine

## Problema

O Quote Engine usa `.eq("category", rxType)` onde `rxType` é sempre `"progressive"` ou `"single_vision"`. As lentes ESSILOR usam categorias mais granulares (`single_vision_digital`, `single_vision_stock`, `occupational`, etc.) que nunca são matcheadas.

**Resultado**: 15 das 34 lentes ESSILOR nunca aparecem em orçamentos.

## Solução

Substituir o filtro exato `.eq("category", rxType)` por um filtro que agrupe categorias equivalentes usando `.in("category", [...])`.

### Mapeamento de categorias

```text
rxType do interpretador  →  categorias aceitas no banco
─────────────────────────────────────────────────────────
"single_vision"          →  single_vision, single_vision_digital,
                             single_vision_stock,
                             single_vision_digital_kids
"progressive"            →  progressive, occupational
```

Categorias especiais (`myopia_control`, `special_drive`, `special_sport`) podem ser incluídas condicionalmente — por exemplo, `myopia_control` só quando o label da receita indica criança, e `special_drive` / `special_sport` quando o cliente mencionar interesse específico.

### Mudança no código

**Arquivo**: `supabase/functions/ai-triage/index.ts` (~linhas 1395-1404)

De:
```typescript
.eq("category", rxType)
```

Para:
```typescript
// Map rxType to compatible categories
const categoryMap: Record<string, string[]> = {
  single_vision: ["single_vision", "single_vision_digital", "single_vision_stock", "single_vision_digital_kids"],
  progressive: ["progressive", "occupational"],
};
const categories = categoryMap[rxType] || [rxType];

// Use .in() instead of .eq()
query = supabase
  .from("pricing_table_lentes")
  .select("*")
  .eq("active", true)
  .in("category", categories)
  ...
```

### Categorias especiais (fase 2, opcional)

Para `myopia_control`, `special_drive` e `special_sport`, adicionar um parâmetro opcional na tool `consultar_lentes`:
- `categoria_especial`: permite a IA incluir essas categorias quando o contexto justificar (ex: "meu filho de 8 anos" → incluir `myopia_control`; "óculos pra dirigir" → incluir `special_drive`)

## Arquivo modificado

| Arquivo | Mudança |
|---------|---------|
| `supabase/functions/ai-triage/index.ts` | Substituir `.eq("category")` por `.in("category")` com mapeamento |

## Resultado

- 34/34 lentes ESSILOR passam a ser elegíveis para orçamento
- Lentes DNZ, DMAX, HOYA, ZEISS continuam funcionando normalmente
- Orçamentos ficam mais competitivos com mais opções de faixa de preço

