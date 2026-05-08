## Problema

O grupo "Setor — Loja" foi criado corretamente (existe no banco, com 11 membros), mas não aparece na lista de conversas do Atrium nem do InFoco Messenger.

**Causa:** a lista de conversas é montada lendo apenas a tabela `mensagens_internas`. Como ninguém ainda enviou mensagem nesse grupo, ele fica invisível — só aparece depois da primeira mensagem.

E como o registro já existe em `conversas_grupo`, o índice único impede recriar (correto).

## Solução

Listar grupos diretamente da tabela `conversas_grupo` (onde o usuário é participante), unindo com as conversas que já têm mensagens. Assim, todo grupo do qual o usuário faz parte aparece imediatamente após a criação, mesmo sem nenhuma mensagem.

### Mudanças

1. **`src/hooks/useMensagensInternas.ts` — query `conversas-internas`**
   - Após buscar mensagens, buscar também `conversas_grupo` onde `auth.uid()` está em `participantes`.
   - Para cada grupo retornado que ainda não está no mapa de conversas (sem mensagens), adicionar uma entrada "vazia" com:
     - `ultima_mensagem`: placeholder ("Grupo criado — envie a primeira mensagem")
     - `ultima_data`: `created_at` do grupo
     - `nao_lidas`: 0
   - Ordenação final continua por `ultima_data` desc.

2. **Realtime**
   - Adicionar listener de `INSERT` em `conversas_grupo` para invalidar `conversas-internas` quando um novo grupo for criado (caso o admin crie em outra aba/sessão).

3. **Projeto InFoco Messenger** (`@project:2d68a67b...`)
   - Aplicar a mesma mudança no hook equivalente lá. Vou inspecionar o projeto e replicar.

### Fora do escopo

- Não mexer no `NovoGrupoDialog` nem nas RLS — já estão corretos.
- Não enviar "mensagem de boas-vindas" automática (evitamos poluir o histórico).
