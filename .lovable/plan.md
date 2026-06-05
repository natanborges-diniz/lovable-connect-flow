## Objetivo

Resolver o `auth_required` ao registrar cashback. Causa: `cashback-loja` cria apenas um client com service-role, e a RPC `regua_registrar_venda` (chamada internamente por `cashback_registrar_resgate`) exige `auth.uid() IS NOT NULL`.

## Mudança (Opção 1)

Em `supabase/functions/cashback-loja/index.ts`, criar **dois clients**:

1. `supabaseAdmin` — service-role puro, sem Authorization. Continua usado para:
   - `auth.getUser(token)` (validação do JWT)
   - leituras de `profiles`, `user_roles`, `telefones_lojas`, `cashback_config`
   - inserts em `contatos` e `eventos_crm` (bypass de RLS)
   - `cashback_consultar_saldo` (não depende de auth.uid)

2. `supabaseAsUser` — service-role **com** `global.headers.Authorization: Bearer <token>` do usuário, para que `auth.uid()` propague no Postgres. Usado **apenas** em:
   - `cashback_registrar_resgate` (que internamente invoca `regua_registrar_venda`)

Sem `auth.persistSession` / `autoRefreshToken` nos dois (são clients de servidor).

### Snippet alvo (criação dos dois clients)

```ts
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const auth  = req.headers.get("Authorization") || "";
const token = auth.replace("Bearer ", "").trim();

// Client admin: bypassa RLS, sem identidade (auth.uid() = null)
const supabaseAdmin = createClient(SUPABASE_URL, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Client autenticado como a loja: service-role + Authorization do usuário
// → auth.uid() = user.id dentro das RPCs SECURITY DEFINER
const supabaseAsUser = createClient(SUPABASE_URL, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { Authorization: `Bearer ${token}` } },
});
```

E a única chamada que muda:

```ts
const { data: resgate, error: errResgate } = await supabaseAsUser.rpc(
  "cashback_registrar_resgate",
  { ...params }
);
```

Todo o resto (`supabase` → renomeado `supabaseAdmin`) permanece igual.

## Restrições respeitadas

- Nenhuma alteração de SQL / migrations.
- Nenhuma alteração no projeto InFoco Messenger.
- Contrato de resposta da função não muda (mesmas chaves: `status`, `cliente`, `ja_processado`, `credito_gerado`, `saldo_atual`, e mesmos `motivo` em erro).

## Validação

Após deploy, rodar teste como loja real autenticada via `supabase--curl_edge_functions` (usa o JWT da sessão do preview, que é uma loja):

```
POST /cashback-loja
{ "action": "registrar",
  "telefone": "<num teste>", "nome": "Teste Cashback",
  "numero_venda": "TEST-<timestamp>",
  "valor_informado": 100, "cashback_usado": 0 }
```

Critérios de sucesso:
- Resposta `status: "ok"` com `cliente`, `credito_gerado`, `saldo_atual`.
- `SELECT * FROM regua_inscricao WHERE numero_venda = 'TEST-<ts>'` → 1 linha.
- `SELECT * FROM cashback_credito WHERE inscricao_id = <id>` → 1 linha.

Colar no chat: trecho da criação dos dois clients + payload de resposta + linhas das 2 tabelas.

## Arquivo afetado

- `supabase/functions/cashback-loja/index.ts` (rename `supabase` → `supabaseAdmin`, novo `supabaseAsUser`, trocar 1 chamada de RPC).
