
Rosana mandou foto da receita e a IA travou em "posso te mostrar uma base e confirmar na loja?" — escalou para humano em vez de seguir o fluxo natural: ler receita → propor opções de orçamento → perguntar loja mais próxima → agendar visita.

Ela ainda mandou "Potirendaba" (região), e o atendimento ficou parado.

## Causa raiz
1. `interpretar_receita` rodou (leu "boa parte"), mas a IA não invocou `consultar_lentes` na sequência — ficou pedindo confirmação genérica ("posso te mostrar uma base?") em vez de já apresentar opções.
2. Repetiu a mesma mensagem 2× (loop) → guardrail escalou para humano.
3. Potirendaba (SP, interior) não é Osasco — região fora de cobertura, deveria entrar no fluxo "Escada de Persuasão Local" (já documentado em `mem://ia/diretrizes-triagem-e-persuasao-local`), mas a IA já tinha travado antes.

## Plano (2 frentes)

### Frente 1 — Resposta imediata para Rosana (manual via send-whatsapp)
Como Potirendaba é fora da área de Osasco, seguir o fluxo correto: pedir desculpas pela demora, reconhecer a receita recebida, esclarecer que a unidade Osasco fica longe e perguntar se ela tem como vir até Osasco/região metropolitana OU se prefere indicação de ótica parceira mais próxima dela.

Texto:
> "Oi Rosana, desculpa a demora! 🙏 Recebi sua receita certinho. Vi que você é de Potirendaba — nossa unidade fica em Osasco/SP, então fica um pouco longe. Você tem como vir até a região (Osasco / Grande SP)? Se sim, te passo as opções de lentes pra sua receita e já agendamos sua visita. Se preferir algo mais perto, me avisa que oriento o melhor caminho 😊"

Enviar via `send-whatsapp` no atendimento ativo de Rosana, remetente "Gael".

### Frente 2 — Correção estrutural no fluxo da IA (ai-triage)

**Regra a adicionar em `ia_regras_proibidas` (categoria `comportamento`):**
> "Após `interpretar_receita` retornar com sucesso (mesmo parcial), NUNCA responder com 'posso te mostrar uma base?' ou pedir nova confirmação. SEMPRE seguir direto para: 1) chamar `consultar_lentes` com os valores lidos, 2) apresentar 2-3 opções de orçamento, 3) perguntar a região/bairro do cliente, 4) sugerir agendamento na loja mais próxima. Confirmação só é necessária se a confiança da leitura for <60% — neste caso, mostrar os valores lidos e pedir confirmação explícita ('OD -2,00 / OE -1,75, confere?')."

**Exemplo modelo em `ia_exemplos` (categoria `pos_receita_fluxo`):**
- pergunta: "[cliente envia foto da receita - leitura OK]"
- resposta_ideal: "Recebi sua receita certinho! 😊 Pra esses valores tenho 3 opções: 1) DNZ Antirreflexo - R$ X (custo-benefício); 2) DMAX Blue UV - R$ Y (filtro azul); 3) HOYA Premium - R$ Z (top linha). Qual região você fica? Te indico a loja mais próxima e já agendamos sua visita pra finalizar 😉"

**Hint determinístico no `ai-triage`:** quando o último evento `eventos_crm` do contato for `receita_interpretada` (sucesso) e a próxima resposta da IA não invocar `consultar_lentes`, injetar `[SISTEMA: receita lida — chamar consultar_lentes AGORA com os valores em metadata.receitas[ultimo] e seguir com loja+agendamento]`.

### Frente 3 — Memória
Atualizar `mem://ia/auto-receita-e-anti-loop.md`: adicionar seção "Pós-leitura — fluxo obrigatório" cobrindo os 4 passos (consultar_lentes → opções → região → agendamento).

### Sem mudanças
- Tabelas/migrações: nenhuma.
- UI: nenhuma.
- Outras EFs: só `ai-triage` (1 hint novo).

## Resultado
- Rosana recebe resposta hoje, alinhada com o fluxo de Escada de Persuasão Local.
- IA passa a, automaticamente, ir da leitura da receita → opções → loja → agendamento, sem travar em "posso te mostrar uma base?".
- Loop pós-receita deixa de existir.
