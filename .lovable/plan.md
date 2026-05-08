## Problema

Em grupo (Atrium `/mensagens`):

1. **Read receipts genéricos** — hoje só mostramos `✓` ou `✓✓ azul` (lido por **todos**). Não dá pra saber **quem** já leu quando ainda nem todos leram.
2. **Editar / Excluir aparentemente sumiram** — cada mensagem em grupo é inserida N vezes (uma linha por destinatário) com mesmo `remetente_id|conteudo|timestamp`. O dedup do `useMensagensConversa` escolhe `copias[0]` como base. Os mutations atuais (`useEditMensagemInterna` e `useDeleteMensagemInterna`) usam `.eq("id", id)` → afetam só **uma** das N linhas. Visualmente vira inconsistente (a UI re-deduca e às vezes o menu/efeito não se reflete) — daí a sensação de "sumiu".

## Solução

### 1. Read receipts detalhados em grupo (`src/pages/Mensagens.tsx` + `useMensagensInternas.ts`)

**a)** No dedup de grupo em `useMensagensConversa` (já agrupa as N cópias), além de `lida_por_todos`/`total_copias`/`lidas_count`, **expor também `leitores_ids: string[]`** = lista de `destinatario_id` das cópias com `lida = true`.

**b)** Em `Mensagens.tsx`, no rodapé do balão de mensagem minha em grupo (linhas ~389–406), trocar o `MessageTicks` simples por:

- Tick ✓ ou ✓✓ azul (mantém comportamento atual baseado em `lida_por_todos`).
- Ao lado, contador clicável: `{m.lidas_count}/{m.total_copias}`.
- Ao clicar, `Popover` lista cada participante (exceto eu) com indicador "lida" (✓ azul) ou "pendente" (○), usando o `participantesNomes` map já carregado.

Não mexer no comportamento de 1:1 (continua só ✓/✓✓).

### 2. Edit / Delete propagam para todas as cópias (`useMensagensInternas.ts`)

Tornar os mutations *grupo-aware*:

- **`useEditMensagemInterna`**: hoje recebe `id`. Adicionar lookup: buscar a linha por `id` para obter `remetente_id`, `conversa_id`, `created_at`, `conteudo` (atual). Se `conversa_id` começa com `grupo_`, fazer:

  ```ts
  await supabase
    .from("mensagens_internas")
    .update({ conteudo: novoConteudo, editada_at, metadata: newMeta })
    .eq("conversa_id", conversaId)
    .eq("remetente_id", remetenteId)
    .eq("conteudo", conteudoAnterior)
    .gte("created_at", isoMinus(created_at, 2_000))
    .lte("created_at", isoPlus(created_at, 2_000));
  ```

  (janela de ±2s para casar todas as cópias do mesmo broadcast). 1:1 continua igual ao atual (`.eq("id", id)`).

- **`useDeleteMensagemInterna`**: mesma estratégia. Em grupo, soft-delete (`deletada_at`, `deletada_por`) em todas as cópias do broadcast com mesma chave `(conversa_id, remetente_id, conteudo, created_at±2s)`.

- O `MessageActionsMenu` já está condicionado a `autorId === currentUserId` + janela de 15min — nenhuma mudança de UI.

### 3. Realtime já cobre

`useMensagensInternas` ouve `event: "*"` em `mensagens_internas` → ao editar/deletar todas as cópias, a query é invalidada e o feed re-renderiza coerente.

## Fora do escopo

- Não muda schema, RLS ou edge functions.
- Não muda o InFoco Messenger (separado — esse update fica no plano anterior).
- Sem "X visualizaram em tal hora" detalhado por horário (V2).
