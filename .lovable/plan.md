# Gate "agendamento na loja da OS"

Quando o cliente recebe `aviso_aguardando_armacao_v2` ou `os_recebida_loja_v2` e responde pedindo para agendar, a IA precisa **forçar a loja da OS** (sem perguntar cidade/loja) e o registro do agendamento precisa ficar **linkado** à OS de origem.

## 1. Migration

Adicionar coluna em `os_recebimento_loja`:
- `agendamento_id uuid null` — FK para `agendamentos(id)` `on delete set null`. Permite saber qual OS gerou qual agendamento e evitar dupla oferta.

(Sem alterações em RLS — a coluna herda as policies existentes.)

## 2. `ai-triage` — contexto novo no prompt

Após carregar `agendamentosAtivos`, query adicional:

```ts
const { data: osPendentes } = await supabase
  .from("os_recebimento_loja")
  .select("os_numero, loja_nome, aviso_armacao_enviado_at, notificado_cliente_at, agendamento_id")
  .eq("contato_id", contatoId)
  .is("agendamento_id", null)
  .or("aviso_armacao_enviado_at.gte.<D-30>,notificado_cliente_at.gte.<D-30>")
  .order("aviso_armacao_enviado_at", { ascending: false })
  .limit(3);
```

Se vier resultado, injeta bloco logo após `agendamentoCtx`:

```
# OS RECENTES DESTE CLIENTE (loja OBRIGATÓRIA se agendar)
- OS {os_numero} na loja {loja_nome} ({fluxo: aguardando_armacao | os_recebida}) — avisado {data}

REGRA: se o cliente pedir para agendar visita relacionada a essas OS (trazer
armação, retirar óculos, etc.), use loja_nome="{loja_nome}" DIRETAMENTE na
tool agendar_visita. PROIBIDO perguntar "em qual loja prefere?" ou oferecer
outras unidades — a armação/produto está fisicamente nessa loja.
```

`fluxo` é deduzido: `aviso_armacao_enviado_at IS NOT NULL` → `aguardando_armacao`; `notificado_cliente_at IS NOT NULL` → `os_recebida`.

## 3. `agendar-cliente` — linkar OS ↔ agendamento

Após o `INSERT` em `agendamentos` bem-sucedido (linha 168):

```ts
// Linka OS recente (mesma loja, mesmo contato, sem agendamento ainda)
const { data: osLink } = await supabase
  .from("os_recebimento_loja")
  .select("id, os_numero, aviso_armacao_enviado_at, notificado_cliente_at")
  .eq("contato_id", contato_id)
  .ilike("loja_nome", loja_nome)
  .is("agendamento_id", null)
  .order("updated_at", { ascending: false })
  .limit(1)
  .maybeSingle();

if (osLink) {
  await supabase.from("os_recebimento_loja")
    .update({ agendamento_id: agendamento.id })
    .eq("id", osLink.id);

  const fluxo = osLink.notificado_cliente_at ? "os_recebida" : "aguardando_armacao";
  await supabase.from("agendamentos")
    .update({ metadata: { os_origem: { os_numero: osLink.os_numero, fluxo, loja_nome } } })
    .eq("id", agendamento.id);
}
```

Sem novos parâmetros na API — derivação automática por `(contato_id, loja_nome)`.

## 4. Memória

Atualizar `mem://regua/os-aguardando-armacao-e-recebimento-loja` com a nova regra:
- "Cliente que responde aos templates `_v2` pedindo agendar → IA força loja da OS via contexto injetado em `ai-triage`; `agendar-cliente` linka `os_recebimento_loja.agendamento_id` automaticamente."

## Fora de escopo

- Nenhuma alteração nos templates ou na bridge.
- Nenhuma mudança no schema da tool `agendar_visita` (a IA continua passando `loja_nome` — só que agora o contexto dita qual valor usar).
- Painel do InFoco Messenger não muda: ele já filtra por loja via RLS.
