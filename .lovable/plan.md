

## Ajuste da URL de deep-link no push de mensagens internas

### Objetivo
Garantir que o push enviado pelo backend ao receber uma `mensagens_internas` abra exatamente a conversa correta no app Infoco Messenger (`/conversas/:otherId`), usando o `remetente_id` como `otherId`.

### Diagnóstico

Hoje o push é gerado em duas camadas:

1. **Trigger por linha**: `trg_push_nova_mensagem_interna()` é chamado em cada `INSERT` em `public.mensagens_internas`.
   - Filtra fora `conversa_id` que comece com `ponte_` ou `demanda_`.
   - Ignora se `destinatario_id` é nulo ou igual ao remetente.
   - Busca `nome` do remetente em `profiles` e gera `preview` (primeiros 80 caracteres da mensagem).
   - Chama `public.fn_send_push(...)` com:
     - `title` = nome do remetente
     - `body` = preview
     - `url` = `'/mensagens?conversa=' || new.conversa_id`
     - `tag` = `'msg_' || new.conversa_id`

2. **Função genérica**: `public.fn_send_push(_user_ids, _title, _body, _url, _tag)` empacota o payload JSON e dispara `net.http_post` para a edge function `send-push`. Ela **não conhece o contexto da mensagem** — só repassa o que a trigger mandou.

Ou seja: o problema **não está em `fn_send_push`**. A URL `/mensagens?conversa=...` é montada pela trigger `trg_push_nova_mensagem_interna`. Para o app Messenger abrir `/conversas/<remetente_id>`, é a trigger que precisa mudar.

`fn_send_push` continua igual — ela é compartilhada por mensagens internas, demandas e notificações genéricas, e cada chamadora monta sua própria URL. Mexer em `fn_send_push` quebraria os outros pushes.

### Plano de execução

1. **Mostrar a definição atual** das duas funções (`pg_get_functiondef` para `trg_push_nova_mensagem_interna` e `fn_send_push`) para o usuário confirmar antes da troca.

2. **Criar uma migração** que substitua **apenas** `public.trg_push_nova_mensagem_interna()`, mantendo:
   - Mesmos filtros (`ponte_*`, `demanda_*`, destinatário válido).
   - Mesma busca de nome do remetente e preview.
   - Mesma chamada a `fn_send_push`.
   - **Única mudança**: `url` passa de `'/mensagens?conversa=' || new.conversa_id` para `'/conversas/' || new.remetente_id::text`.
   - `tag` continua `'msg_' || new.conversa_id` (garante coalescência por conversa no SO).

3. **Não recriar o trigger** em `mensagens_internas`. Como apenas o corpo da função muda (mesmo nome, mesma assinatura), o trigger atual continua válido e apontando para a nova versão automaticamente.

4. **Não tocar em** `fn_send_push`, `trg_push_nova_notificacao`, `trg_push_demanda_loja_resposta`, edge function `send-push` nem em `public.app_config`.

5. **Confirmar pós-migração**: rodar `pg_get_functiondef` da nova `trg_push_nova_mensagem_interna` e colar o código no chat para validação.

### Detalhes técnicos

- Migração SQL (resumo do que será aplicado):
  ```sql
  CREATE OR REPLACE FUNCTION public.trg_push_nova_mensagem_interna()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $$
  declare
    _autor_nome text;
    _preview text;
  begin
    if new.conversa_id like 'ponte_%' or new.conversa_id like 'demanda_%' then
      return new;
    end if;
    if new.destinatario_id is null or new.destinatario_id = new.remetente_id then
      return new;
    end if;

    select nome into _autor_nome from public.profiles where id = new.remetente_id;
    _preview := left(coalesce(new.conteudo, ''), 80);

    perform public.fn_send_push(
      array[new.destinatario_id],
      coalesce(_autor_nome, 'Nova mensagem'),
      _preview,
      '/conversas/' || new.remetente_id::text,
      'msg_' || new.conversa_id
    );
    return new;
  end;
  $$;
  ```
- Ressalva: o app `infoco-ops` (este projeto) não tem rota `/conversas/:id`. Esse deep-link só funciona quando o push for aberto no app Atrium Messenger (`desktop-joy-app.lovable.app`), que é exatamente o destino desejado para mensagens internas. Para usuários que receberem o push enquanto estiverem com o painel `infoco-ops` aberto no navegador, a URL não vai casar com nenhuma rota local — comportamento esperado, já que mensagens internas vivem no Messenger.

### Resultado esperado

- Push de nova mensagem interna chega no celular com:
  - título = nome do remetente
  - corpo = primeiros 80 caracteres da mensagem
  - ao tocar, abre `/conversas/<uuid-do-remetente>` no Messenger
- Pushes de demandas e notificações genéricas continuam funcionando exatamente como antes.

