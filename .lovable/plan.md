## Objetivo

Notificar via Web Push (com som padrão do sistema) o operador atribuído ao atendimento sempre que:
1. O atendimento for direcionado para humano (`modo='humano'`, escalada da IA ou transferência manual de coluna);
2. Chegar uma nova mensagem inbound do cliente enquanto o atendimento estiver em modo humano;
3. O card for movido manualmente para uma coluna do setor do operador.

Reaproveita a infra existente (`push_subscriptions` + edge `send-push` + `sw.js` + `fn_send_push`).

## Gap atual

`atendimentos` só tem `atendente_nome` (texto). Não há FK para o usuário — impossível resolver "operador atribuído" sem ajuste. Vou adicionar `atendente_user_id uuid` e preenchê-lo automaticamente quando o operador "assumir" o card (primeira resposta humana / abertura do drawer / drag para coluna de humano).

## Mudanças

### 1. Banco

- Adicionar coluna `atendimentos.atendente_user_id uuid` (nullable, índice).
- Trigger `trg_atendimento_modo_humano` (AFTER UPDATE em `atendimentos`):
  - Quando `modo` mudar para `humano` OU `pipeline_coluna_id` mudar para coluna de setor humano, e houver `atendente_user_id`: `INSERT` em `public.notificacoes` (`tipo='atendimento_humano'`, `usuario_id=atendente_user_id`, título "Atendimento aguardando você", mensagem com nome do contato e snippet, `referencia_id=atendimento.id`).
  - Sem atendente atribuído → notifica todos os operadores ativos do setor (`setor_id` via `pipeline_coluna_id → pipeline_colunas.setor_id`).
- Trigger `trg_inbound_humano_push` (AFTER INSERT em `public.mensagens`):
  - Se `direcao='inbound'` e o atendimento estiver em `modo='humano'` e `status<>'encerrado'`: `INSERT` em `notificacoes` para `atendente_user_id` (fallback: setor). Título "Nova mensagem de {contato}", mensagem = primeiros 100 chars do `conteudo`, `url=/atendimentos?atendimento={id}`, `tag=at_{id}` (renotify=true colapsa).
- O trigger existente `trg_push_nova_notificacao` já dispara `fn_send_push` → `send-push` (Web Push com VAPID) automaticamente. Som = padrão do sistema (já configurado em `sw.js` via `vibrate` + notificação nativa).

### 2. Edge function `pipeline-automations`

Já recebe eventos de mudança de coluna. Adicionar bloco: quando `entity_type='atendimento'` (ou via lookup do atendimento ligado ao contato/solicitação) e a coluna nova pertence a setor humano, marcar `atendente_user_id` apenas se houver claim manual — caso contrário deixa null para notificar setor inteiro.

### 3. Frontend

- `useAtendimentos`: ao abrir um atendimento em modo humano (drawer/click), chamar mutation `claimAtendimento(id)` que faz `UPDATE atendimentos SET atendente_user_id=auth.uid(), atendente_nome=profile.nome WHERE id=? AND atendente_user_id IS NULL`.
- Em `src/pages/Atendimentos.tsx`: exibir "Atribuído a {nome}" e botão "Liberar" para devolver à fila.
- Garantir que `PushNotificationsButton` esteja visível em `/atendimentos` (já está no layout).

### 4. RLS / Grants

- `atendentes` já tem RLS; adicionar policy `UPDATE` para `setor_usuario`/`operador` poderem setar `atendente_user_id` no próprio setor.
- Conceder `GRANT UPDATE (atendente_user_id, atendente_nome) ON public.atendimentos TO authenticated`.

## Som

Usa o som nativo do device entregue pelo Web Push (iOS PWA 16.4+ e Android Chrome). Nada extra precisa ser feito no `sw.js` — `showNotification` já toca o som padrão. Sem áudio customizado in-app.

## Critério de aceite

- IA escala um atendimento → operador do setor (ou atribuído) recebe push imediato com som.
- Cliente responde → operador atribuído recebe push (tag colapsa para não empilhar).
- Card movido manualmente para coluna humana → push para usuários elegíveis.
- Clique na notificação abre `/atendimentos?atendimento={id}` focando o card.