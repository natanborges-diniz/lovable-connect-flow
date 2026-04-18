
O usuário quer entender por que, num diálogo onde o cliente pediu explicitamente preço de lentes Kodak multifocais (com Transitions, antirreflexo, etc.) e enviou a receita, a IA não passou preços e escalou para humano.

Isso é uma investigação, não implementação. Vou diagnosticar olhando os dados reais do atendimento e os logs.

## Hipóteses iniciais

1. **OCR da receita falhou ou veio com baixa confiança** — IA disse "consegui ler boa parte" 3x seguidas, sinal clássico de que `interpretar_receita` retornou parcial e ela ficou em loop.
2. **Watchdog de loop ou guardrail de similaridade** — repetiu a mesma frase 3x → `watchdog-loop-ia` ou `detectLoop` escalou pra humano automaticamente (memória `auto-receita-e-anti-loop` confirma isso).
3. **Quote engine sem catálogo Kodak** — `pricing_table_lentes` pode não ter linhas com `brand = 'Kodak'`, então `consultar_lentes` retornou vazio e a IA fugiu pra escalada.
4. **Catálogo tem Kodak mas a IA não disparou `consultar_lentes`** — ficou presa em "posso te mostrar?" em vez de já mostrar (viola a diretriz reativa+proativa: receita salva → consultar).

## Plano de investigação

### 1. Identificar o atendimento
Buscar em `atendimentos` + `mensagens` o contato "Leandro Laba" / horário 21:34–21:54 de hoje, pegar `atendimento_id`.

### 2. Inspecionar metadados
- `contatos.metadata.receitas[]` — ver se a receita foi salva e com que confiança
- `mensagens.metadata` das 3 respostas repetidas — ver se vieram do guardrail / fallback
- `eventos_crm` desse contato — procurar `loop_ia_escalado`, `loop_ia_escalado_watchdog`, `precisa_humano`

### 3. Verificar catálogo Kodak
`SELECT brand, family, category, count(*) FROM pricing_table_lentes WHERE brand ILIKE '%kodak%' GROUP BY 1,2,3` — confirmar se existe e cobre multifocal/Transitions/AR.

### 4. Logs do `ai-triage`
Filtrar por `atendimento_id` no horário, ver:
- se `interpretar_receita` foi chamada e o que retornou
- se `consultar_lentes` foi chamada
- se houve disparo de loop detector
- motivo do `precisa_humano = true`

### 5. Diagnóstico final
Cruzar tudo e produzir uma causa raiz única + recomendação de correção (que viraria um plano de implementação na sequência, se for o caso).

## Detalhes técnicos

- A escalada "Vou chamar alguém da equipe" é a frase padrão quando a IA seta `modo='humano'` via tool `escalar_humano` ou via watchdog.
- A repetição triplicada de "Consegui ler boa parte da sua receita, mas quero te passar a opção certinha. Posso te mostrar uma base e confirmar na loja?" + a dica de "prefiro texto" são fortes indícios de loop detectado pelo watchdog (cron 2min).
- Memória relevante: `mem://ia/auto-receita-e-anti-loop`, `mem://ia/lentes-de-contato-orcamento` (mas aqui é óculos, então `pricing_table_lentes`), `mem://ia/quote-engine-lentes-e-categorias`.

## Próximo passo
Se você aprovar, eu rodo as queries e leio os logs do `ai-triage` desse atendimento e te trago a causa raiz com a correção sugerida (provavelmente: faltam linhas Kodak no catálogo OU o `interpretar_receita` está retornando confiança baixa que trava o `consultar_lentes`).
