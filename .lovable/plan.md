# Fix: títulos de botão WhatsApp cortados

## Causa

Meta limita `button.reply.title` a **20 caracteres**, e emojis multibyte (🔎, 💬) contam como 2 unidades UTF-16. O helper `trunc(b.titulo, 20)` em `supabase/functions/send-whatsapp/index.ts` corta com `…` quando estoura — o que está acontecendo no menu de loop e nas reações ao orçamento.

Strings atuais (todas com 21 unidades):
- `🔎 Quero um orçamento`
- `💬 Falar com a equipe`

`📅 Agendar visita` (17) passa direto.

## Mudança proposta

Encurtar apenas os títulos visíveis no botão (mantendo `id` e fluxo intactos):

| Antes | Depois | Tamanho |
|---|---|---|
| `🔎 Quero um orçamento` | `🔎 Orçamento` | 12 |
| `💬 Falar com a equipe` | `💬 Falar com equipe` | 19 |
| `📅 Agendar visita` | `📅 Agendar visita` | 17 (sem mudança) |

## Arquivos afetados

`supabase/functions/ai-triage/index.ts`, três blocos:

1. **Linhas 6427–6431** — menu de loop ("Pode me ajudar a te ajudar melhor?")
   - `loop_menu_orcamento` → `🔎 Orçamento`
   - `loop_menu_humano` → `💬 Falar com equipe`

2. **Linha 9677** — reação ao orçamento (mesmos botões `orcamento_agendar` / `orcamento_duvida` / `orcamento_mais_barato`). Verificar se `orcamento_duvida` e `orcamento_mais_barato` também estouram e ajustar (provavelmente sim — `💸 Quero mais barato` ~21).

3. **Linha 10099** — segundo ponto que reusa `orcamento_agendar`. Mesma normalização.

## Validação

- `grep` no arquivo deployado após edit confirma novos títulos.
- Reabrir conversa de teste 11963268878, disparar loop e reação ao orçamento, conferir botões na imagem do WhatsApp.
- Garantir que `routeButtonClick()` continua casando pelos `id`s (não tocados).

## Escopo

Só presentation/strings em `ai-triage`. Sem mudança em `send-whatsapp`, sem migração, sem alteração de tools/LLM.
