
## Objetivo
Aplicar o mesmo fluxo correto de orçamento para lentes de contato com receita no caso da Kelly: sem repetir “dois caminhos”, sem escalar para humano, e sem travar após “Lentes de contato” / “Orçamento”.

## Diagnóstico encontrado
O ajuste anterior ficou incompleto em `ai-triage`:
1. O bloco global de pós-receita ainda força `consultar_lentes` (óculos), não `consultar_lentes_contato`.
2. O `forcedIntent` reconhece LC, mas o hint “sem loop” só cobre `consultar_lentes` e `interpretar_receita`, deixando `consultar_lentes_contato` sem reforço.
3. O fallback determinístico ainda devolve “Recebi sua receita aqui... dois caminhos...”, causando repetição mesmo com receita já salva.
4. Se o modelo falhar em tool call, ainda pode cair em fallback genérico ou escalar indevidamente.

## Implementação proposta

### 1) Ajustar `supabase/functions/ai-triage/index.ts`
Corrigir os pontos restantes do fluxo LC pós-receita:

- Tornar o bloco `[SISTEMA: FLUXO PÓS-RECEITA OBRIGATÓRIO]` sensível a contexto LC:
  - se contexto for lente de contato, forçar `consultar_lentes_contato`
  - se não for LC, manter `consultar_lentes`

- Ampliar o branch de `forcedIntent` sem loop:
  - incluir `consultar_lentes_contato`
  - injetar hint explícito para:
    - usar a tool agora
    - apresentar 2-3 opções com descartes variados
    - pedir região
    - sugerir loja/agendamento

- Blindar o fallback determinístico:
  - se já houver receita salva + contexto LC, nunca responder com “dois caminhos”
  - em vez disso, responder com continuação curta orientada a orçamento, ou preferencialmente cair na tool correta

- Revisar o caminho de baixa confiança da receita:
  - manter pedido de confirmação textual só quando necessário
  - mas sem travar o fluxo: já orientar a IA a mostrar opções genéricas de LC quando a leitura estiver incompleta, como definido na memória

### 2) Reforçar saída da tool `consultar_lentes_contato`
A tool já existe, mas o plano é deixar a resposta mais aderente ao fluxo recomendado:
- 2-3 opções com categorias variadas quando houver compatibilidade
- diária como dica consultiva para esporte, sem excluir quinzenal/mensal
- finalizar com pergunta de região
- evitar CTA genérico de “quer que eu reserve?” como única saída quando o objetivo ainda é orçamento/encaminhamento

### 3) Atualizar aprendizado/memória
Atualizar `.lovable/memory/ia/lentes-de-contato-orcamento.md` com o caso Kelly:
- quando cliente já mandou receita e depois responde “Lentes de contato” ou “Orçamento”, isso deve ser tratado como intenção clara
- nunca repetir “posso seguir por dois caminhos?”
- nunca escalar para humano nesse cenário
- fluxo obrigatório: tool LC → opções → região → loja/agendamento

### 4) Resposta operacional imediata para Kelly
Além do ajuste estrutural, enviar resposta manual no atendimento ativo com o fluxo correto:
- reconhecer pedido de orçamento
- usar a receita salva
- trazer 2-3 opções compatíveis
- pedir região para indicar a unidade

## Resultado esperado
- Kelly não recebe mais repetição de “dois caminhos”.
- “Lentes de contato” / “Orçamento” com receita salva passa a disparar o fluxo correto de LC.
- A IA deixa de escalar injustamente para humano nesse cenário.
- O comportamento fica consistente com o caso anterior já corrigido.

## Arquivos a ajustar
- `supabase/functions/ai-triage/index.ts`
- `.lovable/memory/ia/lentes-de-contato-orcamento.md`
