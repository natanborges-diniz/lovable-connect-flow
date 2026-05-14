# Plano

## 1. Bloco de Hierarquia em `buildSystemPromptFromCompiled()`

Em `supabase/functions/ai-triage/index.ts` (linha 1727), inserir como **primeiro `s.push(...)`** — antes de `buildDateContext()` — o bloco fixo:

> "HIERARQUIA DE INSTRUÇÕES — Em caso de conflito entre os blocos abaixo, siga rigorosamente esta ordem de prioridade: (1) RECEITA PENDENTE… (2) PÓS-RECEITA OBRIGATÓRIO… (3) DESPEDIDA OU DISPENSA… (4) INTENÇÃO DETECTADA… (5) PROMPT COMPILADO PRINCIPAL… (6) DEMAIS BLOCOS… Nunca misture instruções de níveis diferentes na mesma resposta."

> **Nota / clarificação:** o pedido fala em "primeiro item do array `callMessages`", mas `buildSystemPromptFromCompiled()` retorna uma **string única** (concatenação de `s[]`); o array `callMessages` propriamente dito vive em `runIA()` (linha 4329) e é o array que vai ao LLM. Vou interpretar a ordem como "primeiro bloco do system prompt construído por essa função" — i.e. primeira posição de `s[]`. Se a intenção era prepend no `callMessages` em si (ou seja, mais externo, vivendo fora do prompt compilado), me avisa que ajusto antes de aplicar.

## 2. Watchdog `countActiveBlocks()`

Adicionar função utilitária no mesmo arquivo que recebe os flags/strings opcionais já passados a `buildSystemPromptFromCompiled` (firstContact, continuity, locationCtx, receitaCtx, sentTopics, isHibrido, escalatedSubject, hasKnowledge, agendamentoCtx) e devolve `{ count: number, ativos: string[] }`. Chamar dentro de `buildSystemPromptFromCompiled()` no final; se `count > 3`, `console.warn("[ai-triage] system prompt com N blocos ativos:", ativos)`.

## 3. Migration `lojas_cidades`

`supabase/migrations/<timestamp>_lojas_cidades.sql`:

```text
create table public.lojas_cidades (
  id uuid primary key default gen_random_uuid(),
  cidade text not null,
  loja_id text not null,
  loja_nome text not null,
  regiao text,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.lojas_cidades enable row level security;
create policy "Leitura autenticada" on public.lojas_cidades
  for select to authenticated using (true);
create policy "Admin gerencia" on public.lojas_cidades
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));
create index idx_lojas_cidades_cidade_ativo on public.lojas_cidades(cidade) where ativo;
```

Seed (a partir de `CIDADE_TO_LOJAS`, linhas 115–120). `loja_id` = slug (ex.: `diniz-uniao`), `loja_nome` = nome exato em `telefones_lojas.nome_loja`, `regiao` = `osasco`/`carapicuiba`/`itapevi`/`barueri` (zona oeste/SP) — preencho `regiao = cidade` por enquanto, podendo evoluir.

| cidade | loja_nome |
|---|---|
| osasco | DINIZ ANTONIO AGU, DINIZ PRIMITIVA I, DINIZ PRIMITIVA II, DINIZ STO ANTONIO, DINIZ SUPER SHOPPING, DINIZ UNIÃO |
| carapicuiba | DINIZ CARAPICUIBA |
| itapevi | DINIZ ITAPEVI |
| barueri | DINIZ BARUERI |

## 4. `loadCidadesLojas()` com cache de 5 min em `ai-triage/index.ts`

- Adicionar no topo do módulo:
  ```text
  let cidadesCache: { data: any[], loadedAt: number } | null = null;
  const CIDADES_TTL_MS = 5 * 60 * 1000;
  ```
- Função `async loadCidadesLojas()` que retorna `{ cidadeToLojas, cidadeLabel, lista }`. Se cache válido, devolve do cache; senão `supabase.from('lojas_cidades').select('*').eq('ativo', true)`.
- Substituir referências a `CIDADE_TO_LOJAS` (linhas 163, 180) e `MSG_LISTA_CIDADES` (linhas 3090, 3131) — funções `formatLojasPorCidade` e `matchLojaEscolhida` viram `async` e recebem o snapshot já carregado, ou fazem `await loadCidadesLojas()` internamente. Os call-sites já são `async`, então o `await` é seguro.
- `MSG_LISTA_CIDADES` passa a ser construída dinamicamente da lista distinta de `cidade` ordenada (mantendo emoji 🏙️ por linha).

## 5. Fallback comentado

Manter `MSG_LISTA_CIDADES`, `CIDADE_TO_LOJAS` e `CIDADE_LABEL` no arquivo, **comentados em bloco** com:

```text
// FALLBACK — usar apenas se a tabela lojas_cidades estiver inacessível
```

E em `loadCidadesLojas()`, no `catch`, devolver esse fallback (descomentando-o como const interna `_FALLBACK_*` que mantemos viva no código mas não usada no caminho feliz).

## Detalhes técnicos

- `buildSystemPromptFromCompiled` continua síncrona: o bloco de hierarquia é estático, então não exige IO.
- `loadCidadesLojas()` usa o client Supabase service-role já existente em `ai-triage` (não precisa de novo import).
- Migration roda antes do deploy do EF; deploy do `ai-triage` automático.
- Sem mudanças em UI / componentes React.

## Validação

1. `supabase--read_query` em `lojas_cidades` para conferir o seed.
2. `supabase--curl_edge_functions` em `ai-triage` com payload de teste para garantir que a string de hierarquia aparece como primeiro bloco do prompt (via log) e que a lista de cidades renderiza igual à versão hardcoded.
