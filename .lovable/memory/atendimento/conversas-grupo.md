---
name: Conversas em grupo no chat interno
description: Grupos sempre derivados de Setor ou Loja (mesmas opções do atendimento humano). Membros auto-sincronizados via trigger. Só admin cria. Sem participantes manuais.
type: feature
---

- Tabela `conversas_grupo` com `tipo_origem` ('setor'|'loja'|'custom') + `origem_ref` (setor_id ou loja_nome).
- Índice único parcial em `(tipo_origem, origem_ref) WHERE tipo_origem<>'custom'` impede duplicar grupo de setor/loja.
- Trigger BEFORE INSERT/UPDATE em `conversas_grupo` chama `calcular_membros_grupo()` e popula `participantes` automaticamente; também sugere nome ("Setor — X" / "Loja — Y").
- Trigger AFTER em `profiles` (setor_id/ativo/metadata) ressincroniza grupos afetados quando alguém entra/sai.
- `conversa_id` continua `grupo_<uuid>`. Send broadcast = N linhas em `mensagens_internas`. RLS via `is_group_member()`.
- UI `NovoGrupoDialog`: radio Setor/Loja → select com opções (mesma fonte do atendimento humano: `setores` ativos + `loja_nome` distinct de `profiles`); preview de membros somente leitura; opções com grupo já existente ficam disabled.
- Grupos legados ficam como `tipo_origem='custom'` (mantidos), mas a UI não permite criar novos custom.
- Apenas admin cria/edita/apaga (RLS inalterada).
