---
name: Conversas em grupo no chat interno
description: Grupo é metadado em conversas_grupo + broadcast em mensagens_internas (conversa_id grupo_<uuid>). Só admin cria. Reusa UI 1:1.
type: feature
---

- Tabela `conversas_grupo` (id, nome, participantes uuid[], criado_por). RLS: SELECT membros+admin; INSERT só admin; UPDATE admin/criador.
- `conversa_id` = `grupo_<uuid>`. Send broadcast = N linhas em `mensagens_internas` (uma por outro participante).
- RLS `mensagens_internas` libera grupo via helper `is_group_member()`. Demandas e 1:1 inalterados.
- Hook `useMensagensInternas` agrega grupos buscando `conversas_grupo` em batch; `useMensagensConversa` deduplica msgs do grupo (mesmo remetente+conteudo+segundo).
- UI: botão Users (admin) abre `NovoGrupoDialog`; header com ícone + N participantes; nome do remetente acima dos balões em grupo.
