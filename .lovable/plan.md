## Problema

Quando `contatos.nome` contém telefone, placeholder ("Cliente", "WhatsApp User") ou foi gerado sequencialmente, o código atual usa esse valor em saudações, gerando coisas como _"Tô com dificuldade…, **5511949841973**"_. O fast-path de extração de nome cobre só parte dos casos — se cliente nunca confirmou e o `senderName` do WhatsApp é inválido, ainda caímos no telefone.

## Plano em 4 camadas

### 1. Cascata de display name (helper único `resolverNomeExibicao`)

Em `ai-triage/index.ts`, criar helper puro que recebe `{ contatoNome, nomePerfilWhatsapp, telefone, nomeConfirmado, precisaConfirmarNome }` e devolve `{ nomeInterno, nomeParaChamar }`:

- **`nomeInterno`** (uso em logs, eventos, prompt como "REFERÊNCIA INTERNA"): sempre preenchido — cascata `contatoNome válido → nomePerfilWhatsapp válido → "Cliente #XXXX"` (sequencial, ver §3).
- **`nomeParaChamar`** (uso em mensagens ao cliente): só preenchido se **`nomeConfirmado === true`** OU se o nome veio do `senderName` do WhatsApp e passou em `looksLikeRealName()`. Senão devolve **`null`** → templates renderizam **sem vocativo** (ex.: `"Tô com dificuldade…"` em vez de `"Tô com dificuldade…, 5511949841973"`).

Validador `nomeEhPlaceholder(s)`: dígitos puros, ≥7 dígitos contidos, regex `/cliente\s*#?\d+/i`, "WhatsApp User", "Contato", vazio.

### 2. Substituir todos os 30+ usos de `contatoNomeAtual.split(" ")[0]`

Trocar por `nomeParaChamar` nas templates de mensagem ao cliente (linhas 2366, 2548, 2670, 2806, 2914, 3064, 3732, 3914–3917, 3923, 4118, 4350, 4704, 5377, 5531–5575, 5741, 5808, 5978, 6054). Cada template já forma `, ${nome}` — quando `nomeParaChamar` é null, o trecho `, ${nome}` colapsa para string vazia.

`contatoNomeAtual` continua sendo usado **internamente** (logs, prompt como "Nome interno do contato: X"), mas nunca mais vaza para o cliente sem confirmação.

### 3. Geração de "Cliente #NNNN" sequencial (interno)

Migration nova:
```sql
create sequence if not exists public.contatos_anonimo_seq;
```

No webhook (`whatsapp-webhook`) e no fast-path de `ai-triage`, quando `contatos.nome` é placeholder/telefone E `senderName` também inválido:
- `select nextval('contatos_anonimo_seq')` → grava `contatos.nome = 'Cliente #' || lpad(seq, 4, '0')` e `metadata.nome_origem='anonimo_sequencial'`, `nome_confirmado=false`, `precisa_confirmar_nome=true`.
- Esse nome **nunca** é usado em mensagens ao cliente (filtrado por `nomeEhPlaceholder` no helper §1) — serve só para listas internas (CRM, Kanban, atendimentos).

### 4. Sistema prompt: separar nome interno vs vocativo

Hoje o prompt diz coisas como "Cliente: {contatoNome}". Trocar por dois blocos:
- `REFERÊNCIA INTERNA (não chamar): {nomeInterno}` — sempre presente.
- `COMO CHAMAR O CLIENTE: {nomeParaChamar || "ainda desconhecido — não use vocativo nem invente nome; siga o fluxo de confirmação de nome se aplicável"}`.

Combinado com a memória `saudacao-confirma-nome.md`, isso garante:
- 1ª/2ª tentativa → IA pergunta o nome (já existe).
- Se cliente nunca responder → IA segue ajudando **sem vocativo**.
- Após 3 tentativas → escala humano (já existe).

## Arquivos tocados

- `supabase/functions/ai-triage/index.ts` — helper + substituições.
- `supabase/functions/whatsapp-webhook/index.ts` — cascata de placeholder + sequencial.
- 1 migration: `create sequence contatos_anonimo_seq`.
- Atualizar memória `mem://ia/saudacao-confirma-nome.md` com a regra "nunca chamar pelo telefone/placeholder".

## Validação

1. Testar 3 cenários via `curl_edge_functions`/replay:
   - Contato com `nome="5511949841973"` → resposta sem vocativo.
   - Contato com `nome_perfil_whatsapp="Beatriz"` válido + nome ainda não confirmado → vocativo "Beatriz" liberado (origem WhatsApp legítima).
   - Contato 100% anônimo novo → recebe `Cliente #0042` interno, mensagens sem vocativo, IA pergunta nome.
2. `read_query` em `contatos` para conferir que nenhum `nome` legado com telefone está sendo "promovido" indevidamente — o helper opera em runtime, não reescreve o banco.