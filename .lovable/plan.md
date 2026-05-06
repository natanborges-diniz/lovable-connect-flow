# Anexo de imagem no card de conversa do cliente

## Objetivo

Permitir que o operador envie **fotos** ao cliente direto do card de conversa (`/crm/conversas` → `src/pages/Atendimentos.tsx`), com legenda opcional, usando WhatsApp Meta Official.

## Estado atual

- Composer só tem textarea + botão Enviar — **não há input de anexo**.
- A UI já **renderiza** imagens recebidas (linhas 434–462): lê `metadata.media_url` + `tipo_conteudo='image'`.
- Edge function `send-whatsapp` só aceita `{ atendimento_id, texto }` e chama Meta com `type: "text"`.
- Bucket `mensagens-anexos` (público) e `whatsapp-media` (público) já existem — usaremos `mensagens-anexos`.

## Mudanças

### 1. Composer com anexo (`src/pages/Atendimentos.tsx`)

- Estado novo: `attachment: File | null`, `attachmentPreview: string | null`, `uploadingAttachment: boolean`.
- Botão **📎 Paperclip** ao lado do textarea (visível só quando `canal === 'whatsapp'` e `msgDirecao === 'outbound'`).
- `<input type="file" accept="image/jpeg,image/png,image/webp" hidden ref={...}>` acionado pelo botão.
- Validações no client: tipo de imagem permitido, tamanho ≤ 5MB (limite prático Meta = 5MB para imagem).
- Mini-preview acima do textarea com a thumb e um "X" para cancelar; o textarea vira "legenda (opcional)".
- `handleSend` ganha branch:
  - Se há `attachment`: faz `supabase.storage.from('mensagens-anexos').upload(...)` em `outbound/{atendimento_id}/{timestamp}-{nome}`, pega `getPublicUrl`, e invoca `send-whatsapp` com `{ atendimento_id, media_url, mime_type, caption: texto || undefined, remetente_nome }` (texto fica opcional).
  - Mantém intercept atual de `outside_24h_window` (não muda).
- Após sucesso: limpa `attachment`, `attachmentPreview`, `msgText`.

### 2. Edge function `send-whatsapp` (`supabase/functions/send-whatsapp/index.ts`)

- Aceitar payload estendido:
  ```ts
  { atendimento_id, texto?, media_url?, mime_type?, caption?, remetente_nome? }
  ```
- Validação: exige `texto` **ou** `media_url`. Se ambos vierem, `media_url` ganha e `texto`/`caption` viram caption.
- Mantém guard de janela 24h.
- Branch novo `sendImageViaMeta(phone, mediaUrl, caption?)` chamando Graph API com:
  ```json
  { "type": "image", "image": { "link": "<url pública>", "caption": "<opcional>" } }
  ```
- Insere em `mensagens` com `tipo_conteudo='image'`, `conteudo = caption || '[image]'`, `metadata = { whatsapp_message_id, provedor, media_url, mime_type }` — formato compatível com o renderer existente.

### 3. Storage / RLS

- Bucket `mensagens-anexos` já é público (Meta consegue baixar). Sem mudança de bucket.
- Adicionar policy de **INSERT/SELECT** em `storage.objects` para `bucket_id = 'mensagens-anexos'` e `auth.role() = 'authenticated'` (verifico se já existe; se sim, pula). Migração via tool de migração caso falte.

## Detalhes técnicos

- **Render**: o componente atual já trata `tipo_conteudo === 'image'` lendo `metadata.media_url`. Para outbound a mensagem aparecerá no lado direito automaticamente porque `direcao` continua sendo `outbound`.
- **Limites Meta**: imagem JPEG/PNG ≤ 5MB, caption ≤ 1024 chars. UI valida ambos.
- **WebP**: Meta aceita, mas alguns clientes WhatsApp renderizam mal — manter no `accept` mas avisar via toast se cair em fallback.
- **Erros**: erros de upload/Meta exibem `toast.error` mantendo o anexo selecionado para retry.
- **Não muda**: bridge interna (DemandaThreadView), receitas/IA, watchdogs.

## Fora de escopo

- Envio de PDF/áudio/vídeo (só imagem nesta entrega).
- Múltiplas imagens por mensagem (1 por vez).
- Compressão client-side (deixamos para próxima iteração se 5MB virar atrito).

## Validação

1. Abrir um atendimento com janela 24h aberta, anexar JPG, enviar com e sem legenda → mensagem aparece no card e chega no WhatsApp.
2. Anexar arquivo > 5MB → toast bloqueia antes do upload.
3. Enviar fora da janela 24h → mantém comportamento atual de `JanelaFechadaDialog` (não tenta enviar mídia).
4. Conferir que mensagem inserida tem `tipo_conteudo='image'` e renderiza com a thumb clicável (link no `metadata.media_url`).