## Mudanças

### Lojas de rua — sábado 09–17 (hoje 09–18)
Antônio Agu, Barueri, Carapicuíba, Itapevi, Primitiva I, Primitiva II, Sto Antônio.
Demais dias mantidos (seg-sex 09–18, dom fechado).

### Shoppings — sábado 10–22 (hoje 09–18, errado)
Super Shopping e União. Demais dias já corretos (seg-sex 10–22, dom 14–20).

### Política de feriados — nenhuma mudança necessária
- Shoppings já têm `default_nacional = abre_horario_domingo` → abrem 14–20 em qualquer feriado nacional.
- 01/01 (Confraternização) e 01/05 (Dia do Trabalho) já estão com `fecha_todas = true` na tabela `feriados`, o que sobrepõe a política da loja e força fechado para todos. Regra do cliente já é cumprida.
- Lojas de rua já têm `default_nacional = fechada`.

## Migration (UPDATE em telefones_lojas)

```sql
UPDATE public.telefones_lojas
SET horarios_semana = jsonb_set(horarios_semana, '{sab}',
  '{"abre":"09:00","fecha":"17:00"}'::jsonb)
WHERE nome_loja IN (
  'DINIZ ANTONIO AGU','DINIZ BARUERI','DINIZ CARAPICUIBA','DINIZ ITAPEVI',
  'DINIZ PRIMITIVA I','DINIZ PRIMITIVA II','DINIZ STO ANTONIO'
);

UPDATE public.telefones_lojas
SET horarios_semana = jsonb_set(horarios_semana, '{sab}',
  '{"abre":"10:00","fecha":"22:00"}'::jsonb)
WHERE nome_loja IN ('DINIZ SUPER SHOPPING','DINIZ UNIÃO');
```

## Validação pós-migration

Chamar `loja_status_no_dia` para conferir:
- sábado típico nas 9 lojas
- 01/01/2026 e 01/05/2026 → `aberta=false` em todas
- Tiradentes 21/04/2026 → shoppings abertos 14–20, lojas de rua fechadas

## Memória

Criar `mem://lojas/horarios-funcionamento.md` com a tabela final (rua e shopping) e regra de feriados. Adicionar referência no índice.

## Sem mudanças em

- Tabela `feriados`, `loja_feriado_politica`
- Edge functions, frontend, prompts da IA
