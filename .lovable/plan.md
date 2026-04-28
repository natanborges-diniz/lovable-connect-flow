## Problema

A função `admin-magic-link` está gerando o link corretamente (logs confirmam `redirect: https://desktop-joy-app.lovable.app`). O que falha é a **cópia automática para a área de transferência**:

- `navigator.clipboard.writeText()` exige `clipboard-write` no iframe pai. O preview do Lovable não concede essa permissão, então a chamada é rejeitada silenciosamente.
- O toast mostra "copiado!" mas nada vai para o clipboard — quando você cola, vem o conteúdo anterior.
- O link aparece no `description` do toast, mas é truncado e não é selecionável de forma confiável.

## Solução

Substituir a "cópia silenciosa + toast" por um **diálogo modal** que:

1. Mostra o link completo dentro de um `<input readOnly>` selecionado automaticamente (`onFocus={e => e.target.select()}`).
2. Botão "Copiar" tenta `navigator.clipboard.writeText` e, se falhar, faz fallback para `document.execCommand('copy')` sobre o input selecionado (funciona em iframes sem `clipboard-write`).
3. Botão "Abrir em nova aba" (`window.open(url, "_blank", "noopener")`) — abre direto no Messenger sem depender de clipboard.
4. Aviso pequeno: "Link válido por 1 hora. Use uma vez."

Esse padrão funciona em qualquer ambiente (preview iframe, app publicado, mobile webview).

## Mudanças

**`src/components/configuracoes/GestaoUsuariosCard.tsx`**
- Adicionar state `magicLinkDialog: { url: string; email: string } | null`.
- Em `generateMagicLink.onSuccess`, em vez de copiar + toast, setar o state para abrir o diálogo.
- Adicionar `<Dialog>` no JSX com:
  - Título: "Link de acesso — {email}"
  - Input readonly com a URL, auto-selecionado.
  - Botão "Copiar" (com fallback `execCommand`).
  - Botão "Abrir no InFoco Messenger" (`window.open`).
  - Botão "Fechar".
- Manter `console.log` do link para debug.

**`src/components/configuracoes/BulkUserProvisioningWizard.tsx`** (se gerar magic link no fluxo)
- Reutilizar o mesmo padrão: lista de links com input readonly + botão copiar por linha + botão "copiar todos" como JSON/CSV. _Confirmar se o wizard gera links nesta etapa antes de tocar — pode estar fora de escopo._

## Fora de escopo

- Não mexe na `admin-magic-link` (já funciona corretamente).
- Não mexe em allowlist do Auth (sistema rejeita).
- Não troca o domínio de destino.
