## Objetivo

Na visualização do chat de Atendimentos, quando uma mensagem outbound for um template (`conteudo` salvo como `[Template: NOME] Params: v1, v2, ...`), exibir o **texto final que o cliente recebeu** — exatamente como ele leu no WhatsApp — em vez da string técnica.

Mudança puramente de UI/apresentação. Nenhuma alteração no envio, nas Edge Functions, no banco ou no formato armazenado.

## Comportamento

Antes (hoje):
```
[Template: retomada_contexto_1] Params: Thalia, seus óculos
```

Depois:
```
┌──────────────────────────────────────────────────────────┐
│ 📨 Template • retomada_contexto_1                        │
│ Oi Thalia! Estávamos conversando sobre seus óculos.      │
│ Ficou com alguma dúvida? Estou aqui pra te ajudar 😊     │
└──────────────────────────────────────────────────────────┘
```

- Pequeno selo discreto no topo (`📨 Template • <nome>`) deixa claro que foi disparo automático.
- Corpo: texto do template com `{{1}}`, `{{2}}`, … substituídos pelos params na ordem.
- Fallback: se o template não existir mais no catálogo ou o parsing falhar, mostra o `conteudo` original (comportamento atual) — nunca quebra.

## Implementação

1. **Util de parsing/render** (novo `src/lib/whatsapp-template-render.ts`):
   - `parseTemplateMessage(conteudo)` → `{ name, params } | null` via regex `^\[Template:\s*([^\]]+)\]\s*Params:\s*(.*)$` (split params por vírgula com `trim`).
   - `renderTemplateBody(body, params)` → substitui `{{1}}..{{N}}` pelos valores; placeholders sem param ficam vazios.

2. **Hook de catálogo** (novo `src/hooks/useWhatsappTemplates.ts`):
   - `useQuery` com `staleTime` longo (ex.: 5 min) buscando `nome, body` de `whatsapp_templates`.
   - Retorna `Map<nome, body>` para lookup O(1).

3. **Componente de bolha de template** (novo `src/components/atendimentos/TemplateMessageBubble.tsx`):
   - Recebe `conteudo` e `templates`. Faz parse + render. Renderiza selo + texto. Se parse falhar ou template ausente → renderiza fallback (`<p>{conteudo}</p>`).

4. **Integração em `src/pages/Atendimentos.tsx`** (linha ~556):
   - Carregar `useWhatsappTemplates()` no componente.
   - No render da mensagem, se `m.conteudo?.startsWith("[Template:")` → usa `<TemplateMessageBubble />`; caso contrário, mantém `<p className="whitespace-pre-wrap break-words">{m.conteudo}</p>` atual.
   - Mantém demais elementos da bolha (timestamps, status, MessageFeedback) intactos.

## Arquivos

- Criar: `src/lib/whatsapp-template-render.ts`, `src/hooks/useWhatsappTemplates.ts`, `src/components/atendimentos/TemplateMessageBubble.tsx`.
- Editar: `src/pages/Atendimentos.tsx` (apenas o trecho de render da mensagem).

## Fora do escopo

- Não altera Edge Functions, cron de recuperação, conteúdo armazenado em `mensagens.conteudo`, ou seleção de template. A confusão semântica entre "remarcação" vs "óculos em geral" continua existindo no envio — fica para a Opção B em outra rodada, se desejar.
