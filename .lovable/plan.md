# Editar/apagar mensagem: só no InFoco Messenger

## Contexto

Hoje os controles de editar/apagar mensagem aparecem em três lugares:

| Local | Tipo de canal | Comportamento atual |
|---|---|---|
| `/mensagens` (chat 1:1 interno) | Interno (App Atrium) | Edita/apaga em tempo real para os dois lados ✅ |
| `/atendimentos` → painel de demanda loja (`DemandaThreadView`) | Interno operador↔loja | Edita/apaga em tempo real para os dois lados ✅ |
| `/atendimentos` → chat com cliente WhatsApp | Externo (Meta) | Soft-delete só interno; **não some no WhatsApp do cliente** ⚠️ |

A última situação é a problemática: o operador acha que apagou, mas o cliente continua vendo no WhatsApp. A Meta Cloud API não expõe endpoint de delete para mensagens já entregues, então não tem como sincronizar. Melhor remover a opção e evitar a falsa sensação de exclusão.

A proposta anterior de adicionar editar/apagar nas bolhas do CRM (`src/pages/Pipeline.tsx`) fica **descartada** — pelos mesmos motivos.

## Mudanças

### 1. Remover editar/apagar do chat WhatsApp em `src/pages/Atendimentos.tsx`

- Tirar render do `MessageActionsMenu` e do ramo `EditableMessageBubble` para mensagens do atendimento (linhas ~547 e ~605).
- Remover imports não usados: `useEditMensagem`, `useDeleteMensagem`, `MessageActionsMenu`, `EditableMessageBubble`, e o estado `editingId` + handlers correspondentes.
- Manter o marcador "• editada" e a bolha "Mensagem apagada" para mensagens que já existirem com `editada_at`/`deletada_at` no histórico (não some retroativamente; só não dá mais para criar novas).

### 2. Não mexer em

- `src/pages/Mensagens.tsx` — chat 1:1 interno, mantém edit/delete.
- `src/components/atendimentos/DemandaThreadView.tsx` — thread operador↔loja, mantém edit/delete.
- Hooks `useEditMensagem` / `useDeleteMensagem` em `useAtendimentos` — ficam no código (ainda podem ser úteis para admin no futuro), só deixam de ser chamados na UI.
- `src/pages/Pipeline.tsx` — não recebe mais a feature, conforme decisão.

## Resultado esperado

- No WhatsApp (Atendimentos e CRM) o operador **não** vê mais o menu "⋮ Editar / Excluir" nas próprias bolhas.
- No InFoco Messenger (`/mensagens` e thread de demanda loja) tudo continua igual: edita até 15 min, apaga com confirmação, sincroniza via Realtime para o outro lado.
- Mensagens antigas que já foram editadas/apagadas continuam exibindo o estado correto.

## Memória a atualizar

Adicionar regra clara: edit/delete de mensagem é exclusivo do canal interno (App Atrium / InFoco Messenger). Nunca habilitar em canais que sincronizam com WhatsApp Meta, porque a Meta não permite apagar do lado do cliente.
