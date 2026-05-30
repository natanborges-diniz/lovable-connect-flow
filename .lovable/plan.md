## Problema
No CRM (`Pipeline.tsx` → `ContatoDetalhe`), o callback `onInsertComposer` do `BuscarLentesSheet` só mostra um toast — o `msgText` vive dentro de `ChatView` e não é acessível pelo pai. Por isso "Inserir no campo de envio" não faz nada além do aviso.

Em `Atendimentos.tsx` já funciona porque `msgText` é estado da própria página.

## Solução
Expor o setter do composer do `ChatView` (no `Pipeline.tsx`) via `forwardRef` + `useImperativeHandle`, e usar essa ref no `ContatoDetalhe` para inserir o texto vindo do copiloto.

### Mudanças em `src/pages/Pipeline.tsx`

1. Converter `ChatView` em `forwardRef`, expondo um handle:
   ```ts
   export interface ChatViewHandle {
     insertComposerText: (texto: string) => void;
   }
   ```
   Implementação:
   - `setMsgText(prev => prev ? prev + "\n\n" + texto : texto)`
   - Focar a textarea (via ref existente ou nova) para o operador revisar.

2. No `ContatoDetalhe`:
   - Criar `const chatViewRef = useRef<ChatViewHandle>(null)`.
   - Passar `ref={chatViewRef}` para `<ChatView … />`.
   - Atualizar o `onInsertComposer` do `BuscarLentesSheet` para chamar `chatViewRef.current?.insertComposerText(text)` em vez do toast atual; manter o toast de sucesso ("Mensagem inserida no campo de envio — revise e envie").

### Fora do escopo
- Refatorar o estado do composer para fora do `ChatView`.
- Mexer no fluxo de `Atendimentos.tsx` (já funciona).
- Alterar a edge function `buscar-lentes-operador` ou o `BuscarLentesSheet`.

## Arquivos
- `src/pages/Pipeline.tsx`
