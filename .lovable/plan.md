

# Correção: Preencher limites técnicos das lentes DNZ e DMAX

## Problema

31 lentes (11 DNZ + 20 DMAX) têm todos os campos de limites técnicos (`sphere_min`, `sphere_max`, `cylinder_min`, `cylinder_max`, `add_min`, `add_max`) como NULL. A query do Quote Engine compara esses campos com o grau da receita — comparação com NULL retorna falso no PostgreSQL — e essas lentes nunca aparecem nos orçamentos.

A query no código está **correta** — o problema é nos dados.

## Solução

Uma única migração SQL para preencher os limites técnicos reais de cada lente, usando como referência os catálogos ópticos padrão e os ranges já cadastrados para HOYA/ZEISS.

### Regras de preenchimento por índice de refração

| Índice | Esférico (min/max) | Cilíndrico (min/max) |
|--------|-------------------|---------------------|
| 1.50 | -6.00 / +6.00 | -4.00 / 0.00 |
| 1.56 | -8.00 / +6.00 | -4.00 / 0.00 |
| 1.59 | -10.00 / +6.00 | -4.00 / 0.00 |
| 1.61 | -10.00 / +6.00 | -4.00 / 0.00 |
| 1.67 | -13.00 / +7.50 | -4.00 / 0.00 |
| 1.74 | -16.00 / +8.00 | -4.00 / 0.00 |

Para progressivas e ocupacionais: `add_min = 0.75`, `add_max = 3.50`.
Para visão simples: `add_min` e `add_max` permanecem NULL (não aplicável).

### Lentes afetadas (31 registros)

**DNZ (11)**:
- 4x progressivas 1.50 → esf -6/+6, cil -4/0, add 0.75/3.50
- 2x progressivas 1.67 → esf -13/+7.50, cil -4/0, add 0.75/3.50
- 1x progressiva 1.74 → esf -16/+8, cil -4/0, add 0.75/3.50
- 1x progressiva 1.50 UV+ → esf -6/+6, cil -4/0, add 0.75/3.50
- 2x single_vision 1.67 → esf -13/+7.50, cil -4/0
- (1x DNZ Pro UV+ 1.50 UV+ progressiva)

**DMAX (20)**:
- 4x "Progressivas Acabadas" 1.56 → esf -8/+6, cil -4/0, add 0.75/3.50
- 7x Infinity (1.56, 1.59, 1.61, 1.67) → ranges conforme índice
- 5x Top (1.56, 1.59, 1.61, 1.67) → ranges conforme índice
- 3x Drive ocupacional (1.56, 1.59) → ranges conforme índice, add 0.75/3.50

### Implementação

**Arquivo**: Migração SQL (via ferramenta de migração)

O SQL fará UPDATE por `brand` e `index_name`, aplicando os ranges corretos. Exemplo:

```sql
UPDATE pricing_table_lentes
SET sphere_min = -6, sphere_max = 6, cylinder_min = -4, cylinder_max = 0,
    add_min = 0.75, add_max = 3.50
WHERE brand = 'DNZ' AND index_name = '1.50'
  AND category = 'progressive' AND sphere_min IS NULL;
```

Cada combinação (brand + index + category) terá seu UPDATE específico.

Nenhuma alteração de código é necessária — a query existente já está correta e funcionará assim que os dados estiverem preenchidos.

## Resultado

- Todas as 31 lentes DNZ/DMAX passam a ser filtradas corretamente pelo grau da receita
- Lentes incompatíveis com o grau do cliente não serão sugeridas
- Quote Engine retorna resultados de todas as marcas (HOYA, ZEISS, DNZ, DMAX)

