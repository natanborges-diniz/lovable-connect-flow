---
name: Edit/Delete Mensagem só Canal Interno
description: Editar/apagar mensagem é exclusivo do InFoco Messenger (chat 1:1 e demandas loja); proibido em canais sincronizados com WhatsApp Meta
type: constraint
---
Os controles de editar/apagar mensagem (`MessageActionsMenu` + `EditableMessageBubble`) só podem ser renderizados onde a mensagem vive 100% no banco interno e o Realtime sincroniza para o outro lado:

- `/mensagens` (chat 1:1, tabela `mensagens_internas`)
- `/atendimentos` → painel de demanda loja (`DemandaThreadView`, `useDemandaMensagens`)

NUNCA habilitar em:
- Painel de chat WhatsApp em `src/pages/Atendimentos.tsx` (mensagens da tabela `mensagens` com `canal=whatsapp`)
- CRM `src/pages/Pipeline.tsx`

**Why:** A Meta Cloud API não expõe endpoint para apagar mensagem já entregue. Soft-delete só interno cria falsa sensação de exclusão — o cliente continua vendo no WhatsApp. Edição idem: o cliente vê a versão original.

Hooks `useEditMensagem` / `useDeleteMensagem` em `useAtendimentos` ficam disponíveis para uso administrativo futuro, mas não devem ser chamados pela UI cliente-facing.
