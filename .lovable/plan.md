## Problema

Ao rodar "Consolidar achados", a edge `audit-ia-consolidar` chama Gemini 2.5 Pro pedindo um JSON com todos os grupos de uma vez. Com muitos achados (a run atual tem dezenas), o modelo esgota o `max_completion_tokens` ainda no "thinking" e devolve JSON cortado (710 chars, parse falha → fallback `{ grupos: [] }`). Resultado: nenhum grupo aparece na UI mesmo com achados existentes.

## Correções em `supabase/functions/audit-ia-consolidar/index.ts`

1. **Trocar para `google/gemini-2.5-flash`** — mesma qualidade para tarefa de agrupamento, sem o overhead de thinking tokens do Pro.
2. **Aumentar `max_completion_tokens` para 16000**.
3. **Processar em lotes (chunking)** — dividir `achados` em blocos de 25 e chamar a LLM uma vez por bloco. Depois mesclar grupos retornados (titulos/categorias iguais viram o mesmo grupo, com `auditoria_ids` concatenados).
4. **Pré-clusterizar por heurística** antes do LLM: agrupar achados que compartilham o mesmo `tipo` em `problemas` (ex.: todos `loop_repeticao` viram 1 cluster), assim o LLM recebe poucos clusters representativos em vez de N achados crus. Isso reduz drasticamente o tamanho do prompt e da resposta.
5. **Logar `finish_reason` e `usage`** do Gemini quando o parse falhar, para diagnóstico futuro.
6. **Mensagem de erro útil na UI**: se a função retornar `total: 0` mas houver achados elegíveis, devolver `{ grupos: [], total: 0, motivo: "llm_sem_grupos" }` para o frontend exibir um toast claro em vez de silêncio.

## Estratégia de chunking (técnico)

```
clusters = group_by(achados, a => primary_problem_type(a))   // heurística local
for each chunk of 25 achados (preservando clusters):
  call LLM → grupos parciais
merged = mergeByTitle(parciais)                              // dedup local
insert merged into ia_auditorias_grupos
```

## Não escopo

- Não mexe na UI do `AuditoriaIaCard.tsx` (já lê `ia_auditorias_grupos` corretamente).
- Não altera schema; usa as tabelas existentes.
- Não toca em `audit-ia-aplicar-grupo` / `audit-ia-ignorar-grupo`.

## Validação

- Rodar "Consolidar achados" na run atual (`f3d53f72…`) e verificar que retorna `total > 0`.
- Conferir nos logs da edge que o parse de JSON não falha mais.
- Verificar na aba "Problemas consolidados" que os grupos aparecem com `auditoria_ids` corretos.
