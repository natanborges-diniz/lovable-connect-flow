

## Plano: Preencher cod_empresa e Corrigir Fallback

### Problema
- Nenhuma das 10 lojas em `telefones_lojas` tem `cod_empresa` preenchido
- O fallback `resolveCodEmpresa` usa a **anon key** do Optical Business, mas a tabela `empresa` tem RLS que bloqueia acesso anônimo — por isso retorna vazio
- Resultado: toda geração de link falha com "Não foi possível identificar a loja"

### O que será feito

#### 1. Consultar o banco do Optical Business para mapear os códigos
Usar uma edge function temporária (ou `curl` via service role) para buscar `SELECT cod_empresa, nome_fantasia FROM empresa` no Optical Business e obter o mapeamento correto.

#### 2. Preencher cod_empresa na tabela telefones_lojas
Executar uma migração SQL com UPDATE para cada loja, baseado no mapeamento obtido:
```sql
UPDATE telefones_lojas SET cod_empresa = '1' WHERE nome_loja = 'DINIZ PRIMITIVA I';
UPDATE telefones_lojas SET cod_empresa = '2' WHERE nome_loja = 'DINIZ PRIMITIVA II';
-- etc para as 10 lojas
```

#### 3. Corrigir o fallback resolveCodEmpresa
Atualizar `supabase/functions/bot-lojas/index.ts` para usar a **service role key** do Optical Business em vez da anon key no fallback. A key já pode ser derivada ou adicionada como secret (`OB_SERVICE_ROLE_KEY`). Também adicionar wildcards `*...*` no filtro ilike para tolerância a variações de nome.

### Resumo de alterações

| Item | Tipo |
|------|------|
| `telefones_lojas` (10 registros) | UPDATE cod_empresa via migração |
| `bot-lojas/index.ts` | Trocar anon key por service role key no fallback |
| Secrets | Possivelmente adicionar `OB_SERVICE_ROLE_KEY` |

### Primeira etapa
Antes de aplicar, preciso consultar a tabela `empresa` do Optical Business para confirmar o mapeamento nome_fantasia ↔ cod_empresa. Farei isso automaticamente na implementação.

