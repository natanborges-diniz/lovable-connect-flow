## Problema

No card **Configurações > Templates WhatsApp**, ao abrir "Novo Template" ou "Editar Rascunho", o `DialogContent` não tem limite de altura nem scroll interno. Em viewports com pouca altura (como o atual, 1020x638), o formulário ultrapassa a área visível e o botão **"Criar Rascunho" / "Salvar Rascunho"** (que é o que de fato salva o template para depois ser submetido à Meta) fica cortado abaixo da tela — sem scroll dá impressão de que "não dá pra submeter".

Nada de errado com a edge function ou com a Meta — é puramente um bug de UI no diálogo.

## Correção

Em `src/components/configuracoes/WhatsAppTemplatesCard.tsx`, ajustar o `DialogContent` (linha 339) para limitar a altura e tornar o conteúdo rolável:

- Trocar `className="max-w-lg"` por algo como `className="max-w-lg max-h-[90vh] overflow-y-auto"`.

Isso garante que:
- O diálogo nunca passa de 90% da altura da janela.
- O conteúdo interno (form + preview + botão) rola dentro do diálogo.
- O botão "Criar Rascunho / Salvar Rascunho" fica sempre alcançável.

## Resumo do que muda

- **1 arquivo**: `src/components/configuracoes/WhatsAppTemplatesCard.tsx`
- **1 linha alterada**: classes do `DialogContent` do formulário de template.

Depois disso, o fluxo volta a funcionar normalmente:
1. Preencher form → clicar **Criar Rascunho** (agora visível).
2. Na lista, clicar **Submeter** ao lado do template → vai para a Meta com status `pending`.
3. Após aprovação, **Sincronizar com Meta** atualiza para `approved` e desbloqueia o disparo.
