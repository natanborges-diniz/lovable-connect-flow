## Diagnóstico

Quando a loja abre **Nova Demanda → Gerar Boleto** no Messenger, a lista de "CPFs aprovados" vem vazia. Causa raiz confirmada no banco:

- Toda `solicitacoes` do tipo `consulta_cpf` foi criada pelo EF `criar-solicitacao-loja` (Atrium) gravando apenas `metadata.alias_loja` (ex.: `"DINIZ STO ANTONIO"`).
- **`metadata.loja_nome` está NULL** em 100% das consultas existentes.
- O wizard do Messenger (e a regra documentada em `boleto-via-cpf-aprovado.md`) filtra por `metadata.loja_nome = <loja do contexto>`. Sem esse campo, nada casa → dropdown vazio.
- O próprio gate no backend (`criar-solicitacao-loja` linha 162) já lê `meta.loja_nome` e não cai no `alias_loja`, então mesmo se a UI mandasse o id, o `LOJA_DIVERGENTE` poderia disparar errado.

Escopo confirmado pelo usuário: corrigir **no Messenger**, mantendo a regra **"só CPFs aprovados da mesma loja do contato"**. A correção precisa acontecer em três pontos (dois aqui no Atrium, um no Messenger).

## Mudanças neste projeto (Atrium)

### 1. `supabase/functions/criar-solicitacao-loja/index.ts`
Em todos os `insert` de `solicitacoes` (linhas ~416, ~539 e o branch de `consulta_cpf`), gravar **ambos** os campos para padronizar a partir de agora:

```ts
metadata: { ...dados, ...extraMetadata,
  loja_nome: nomeLoja,    // ← novo, canonical p/ filtros
  alias_loja: nomeLoja,   // legado, mantém compat
  cod_empresa: codEmpresa,
  origem_app: "infoco_messenger",
}
```

No gate `gerar_boleto`, ler com fallback para não quebrar consultas antigas:
```ts
const lojaConsulta = String(meta.loja_nome || meta.alias_loja || "").trim().toLowerCase();
```

### 2. Migration de backfill (data-only, sem schema)
```sql
UPDATE public.solicitacoes
SET metadata = metadata || jsonb_build_object('loja_nome', metadata->>'alias_loja')
WHERE tipo = 'consulta_cpf'
  AND (metadata->>'loja_nome') IS NULL
  AND (metadata->>'alias_loja') IS NOT NULL;
```
(Roda como migration de dados; cobre as ~9 consultas existentes mostradas no diagnóstico e quaisquer outras antigas.)

## Mudança no projeto Messenger (instrução, não execução)

O dropdown de CPFs aprovados em `LojaNovaDemanda.tsx` (wizard Gerar Boleto) deve manter o filtro por loja, mas tolerar o legado:

```ts
.eq('tipo', 'consulta_cpf')
.eq('metadata->>resultado_consulta', 'aprovado')
.is('metadata->>boleto_solicitacao_id', null)
.or(`metadata->>loja_nome.eq.${lojaCtx},metadata->>alias_loja.eq.${lojaCtx}`)
.gte('created_at', now - 60d)
```

Após o backfill do passo 2, o `OR` passa a ser redundante — mas deixa a UI robusta no período de transição.

## Verificação

1. Rodar a migration e conferir: `SELECT count(*) FROM solicitacoes WHERE tipo='consulta_cpf' AND metadata->>'loja_nome' IS NULL;` deve cair para zero (ou só consultas sem `alias_loja`, que são bug de origem antigo).
2. Criar uma nova consulta_cpf pelo Messenger e confirmar que `metadata.loja_nome` é salvo.
3. No Messenger, abrir Nova Demanda → Gerar Boleto na loja `DINIZ STO ANTONIO` — deve listar as 3 consultas aprovadas dessa loja (07624072807, 54100657862, 18550196800).

## Fora do escopo

- Adicionar seletor de CPF aprovado no `CreateCardDialog` do Atrium (usuário descartou — emissão manual pelo operador segue sem gate de consulta).
- Mudar a UI ou validações do `CpfApprovalDialog`.
- Limpar/renormalizar o campo `cpf` com espaços (`" 07624072807"`).
