## Objetivo
Corrigir o fluxo para que, quando o cliente já pediu orçamento e a receita é lida com sucesso, o sistema envie automaticamente 2–3 opções de lentes com preços, sem cair em respostas contraditórias ou pedir a receita novamente.

## Diagnóstico confirmado
O caso do André mostra 3 falhas combinadas:

1. Duplicidade de processamento no inbound
- A mesma conversa recebeu múltiplos envios/reprocessamentos de imagem e nome em segundos.
- O webhook salva mensagens inbound repetidas com o mesmo `whatsapp_message_id` e dispara o `ai-triage` de novo.
- Isso explica a sequência de respostas conflitantes e repetidas.

2. OCR bem-sucedido não encadeou orçamento de forma determinística
- Às 13:38:35 a receita válida foi salva como `single_vision` com confiança 0.82.
- Mesmo assim, a resposta enviada foi apenas a leitura da receita (`Li sua receita...`) e não o orçamento.
- O fluxo pós-receita está descrito no prompt, mas a execução do tool `interpretar_receita` ainda depende do `args.resposta` e não força a continuação para `consultar_lentes` quando já existe intenção explícita de orçamento.

3. `consultar_lentes` pode pegar a receita errada quando há receitas duplicadas com o mesmo label
- O log recente mostra `consultar_lentes: {"receita_label":"cliente"}`.
- O código usa `find(...)` por label, o que retorna a primeira receita `cliente` salva.
- No caso do André, a primeira receita `cliente` era a leitura inválida (`rx_type=unknown`), então o orçamento cai no fallback pedindo os valores por texto, mesmo havendo uma leitura válida mais recente.

## Plano de correção

1. Blindar duplicidade no `whatsapp-webhook`
- Antes de inserir uma inbound em `mensagens`, verificar se já existe o mesmo `whatsapp_message_id` no atendimento.
- Se já existir, ignorar a inserção e não disparar o `ai-triage` novamente.
- Aplicar isso a texto e mídia para cortar a cascata de respostas repetidas.

2. Tornar o pós-OCR determinístico quando já houver pedido de orçamento
- No branch `interpretar_receita` do `ai-triage`, detectar se o cliente já pediu preço/orçamento/opções antes ou junto da leitura.
- Se a receita ficou válida e a intenção pendente for orçamento de óculos, encadear imediatamente a lógica de `consultar_lentes` na mesma execução.
- Resultado esperado: ao invés de só dizer “li sua receita”, já responder com opções e preços.

3. Corrigir seleção da receita em `consultar_lentes`
- Quando `receita_label` existir em múltiplas receitas, escolher a mais recente e válida, não a primeira encontrada.
- Se houver receita inválida mais antiga e válida mais nova com o mesmo label, sempre usar a válida mais recente.
- Reaproveitar `isReceitaValida` / `hasReceitasValidas` para centralizar a regra.

4. Remover fallback enganoso após OCR válido
- Ajustar o fluxo para não mandar “me confirma os valores por texto” quando a receita válida recém-lida já contém dados suficientes para cotação.
- Só pedir texto quando a receita realmente estiver incompleta ou tecnicamente insuficiente para consulta.

5. Adicionar observabilidade mínima para evitar regressão
- Logar explicitamente:
  - quando um inbound duplicado for descartado;
  - qual receita foi escolhida para orçamento (`label`, timestamp, validade);
  - quando o pós-OCR fizer auto-chain para orçamento.
- Isso facilita confirmar em produção que o caso do André ficou coberto.

## Resultado esperado
Após a correção, o fluxo ideal passa a ser:

```text
cliente pede orçamento
→ envia receita
→ sistema interpreta
→ se a leitura for válida e já houver intenção de orçamento
→ sistema consulta pricing_table_lentes na mesma execução
→ envia 2–3 opções com preço
→ pergunta região/bairro para indicar a loja
```

No caso do André, a resposta correta passaria a ser algo no formato:
- confirmação curta da leitura;
- 2–3 opções de lentes compatíveis com preço;
- aviso de que a armação será validada com o consultor / disponibilidade na loja, se aplicável.

## Detalhes técnicos
Arquivos principais:
- `supabase/functions/whatsapp-webhook/index.ts`
- `supabase/functions/ai-triage/index.ts`

Pontos exatos já identificados:
- `whatsapp-webhook`: insert inbound + trigger do `ai-triage` sem dedupe por `whatsapp_message_id`
- `ai-triage` branch `interpretar_receita`: hoje salva RX e responde, mas não encadeia cotação de forma garantida
- `ai-triage` branch `consultar_lentes`: usa `find(...)` por `receita_label`, favorecendo receita antiga inválida

Se você aprovar, eu implemento essas correções e deixo esse cenário protegido para próximos atendimentos.