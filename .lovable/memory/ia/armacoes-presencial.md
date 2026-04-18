---
name: Armações são produto presencial
description: Pedidos de "modelos de óculos / armações" são tratados por router determinístico que convida para uma das 3 lojas de Osasco; IA nunca lista marcas inventadas nem confunde com orçamento de lentes
type: feature
---

# Armações = produto presencial

## Regra
"Modelos de óculos", "modelos de armação", "ver armações", "fotos de armação", "catálogo de armação" → **NUNCA** listar lentes, NUNCA inventar modelos/preços de armação.

A IA responde com **convite presencial** padrão e oferece as 3 lojas de Osasco:
- 📍 Antônio Agú (centro)
- 📍 União Osasco (shopping)
- 📍 SuperShopping (até 22h)

## Implementação
- Router determinístico em `supabase/functions/ai-triage/index.ts` (bloco `[ROUTER] Armações/modelos detected`).
- Dispara antes de qualquer tool de quote.
- Marca `contatos.metadata.armacoes_orientado = true` para evitar loop no próximo turno.
- Marcas mencionadas no convite (apenas vitrine, sem preço): Ray-Ban, Oakley, Vogue, Carolina Herrera, linha Diniz exclusiva, infantis, esportivas.

## Anti-duplicação de orçamento de lentes
A saída formatada de `consultar_lentes` ("🔍 Opções de lentes para o seu grau") agora compara com as últimas 3 mensagens outbound (similaridade > 0.9). Se duplicada, substitui por follow-up curto (`"Já te mandei as opções acima 😊..."`) — log `[DEDUPE] consultar_lentes duplicado bloqueado`.

## Não confundir com
- Pedido explícito de **lente** ("orçamento de lente", "lentes compatíveis", "preço de lente") → segue fluxo normal de `consultar_lentes` / `consultar_lentes_contato`.
- Pedido de **passagem/remontagem** → ver `mem://ia/glossario-servicos-opticos`.
