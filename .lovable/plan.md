## O que aconteceu no caso do Artur

A conversa andou até o ponto certo: a IA interpretou a receita, trouxe opções de lentes de contato e até perguntou se queria reservar.

O problema começou depois disso:
- o cliente respondeu **"Acuvue"**
- depois **"Quero reservar"** / **"Quero reservar as lentes de contato"**
- e a IA caiu em resposta genérica: **"Me explica melhor a sua necessidade..."**

Ou seja: o sistema conseguiu vender, mas falhou no **fechamento**.

## Causa raiz

No `supabase/functions/ai-triage/index.ts`:

1. **Não existe intent forte para "escolhi uma lente e quero reservar".**
   `detectForcedToolIntent` só cobre orçamento, interpretar receita e agendamento. Quando o cliente fala só **"Acuvue"**, não casa com nenhum fluxo. Quando fala **"quero reservar"**, é mapeado como agendamento genérico — mas não há loja nem data, então a IA não consegue chamar `agendar_visita` e fica perdida.

2. **Não há continuidade pós-orçamento de LC.**
   O prompt força `consultar_lentes_contato` para apresentar opções, mas não há regra para o passo seguinte (cliente escolheu marca / pediu reserva).

3. **Validador cai no pool genérico** ("Me explica melhor a sua necessidade…") quando o modelo não executa ação útil — exatamente o que apareceu no diálogo.

## Correção proposta

### 1. Intent determinístico para fechamento de LC

Expandir `detectForcedToolIntent` para reconhecer:
- "quero reservar", "quero fechar", "vou querer", "fica com a X", "pode reservar", "quero pedir", "quero essa"
- nome de marca isolado (Acuvue, Biofinity, Solflex, DNZ, Air Optix, Oasys) **quando** já houve `consultar_lentes_contato` recente

Quando esse padrão for detectado em **contexto LC com receita salva e opções já apresentadas**, marcar o intent como **fechamento_lc** (novo).

### 2. Encaminhamento obrigatório para HUMANO no fechamento

**Regra nova e principal:** assim que o cliente confirma uma escolha de lente de contato (marca/modelo) ou pede reserva, a IA deve **encerrar a triagem e passar para um humano fechar a venda**.

Comportamento concreto:
1. Reconhecer a opção escolhida (echo curto: "Perfeito — você escolheu a Acuvue Oasys para Astigmatismo").
2. Reforçar que é sob encomenda quando aplicável (pagamento confirma a reserva).
3. **Acionar `escalar_consultor`** com motivo `fechamento_lentes_contato` e setor de vendas/loja apropriado.
4. Marcar `atendimentos.modo = 'humano'` para parar a IA.
5. Mover o card no pipeline para a coluna de fechamento (ex.: "Negociação" / "Fechamento" — usar a coluna de fechamento já existente do CRM).
6. Registrar `eventos_crm` com `tipo = 'fechamento_lc_escalado'` contendo: marca escolhida, descarte, preço, região do cliente, loja sugerida.
7. Enviar uma única mensagem ao cliente confirmando que um Consultor especializado vai dar continuidade ao pedido (sem prometer prazo automático).

Exemplo de mensagem final da IA antes de passar para humano:
> "Perfeito, Artur — você escolheu a *Acuvue Oasys para Astigmatismo* 👌 Como é uma lente tórica sob encomenda, o pagamento confirma a reserva. Já estou chamando um Consultor da nossa equipe pra te passar o link de pagamento e te dar continuidade no pedido. Em instantes ele te chama por aqui mesmo 🤝"

### 3. Bloquear "agendar_visita" como fallback de reserva de LC

Hoje "quero reservar" cai no intent de agendamento. Quando o contexto é **LC + receita salva + opções já apresentadas**, "reservar" deve significar **fechar pedido**, não marcar visita. Adicionar guardrail para impedir essa rota errada nesse cenário específico.

### 4. Blindar o validador

Adicionar guardrail no pós-validação: em contexto de LC com receita salva + orçamento recém-apresentado + cliente confirmando escolha, é **proibido** usar o `VALIDATOR_FAILED_POOL` ("me explica melhor…"). O fallback nesse contexto deve ser o próprio fluxo de escalonamento para humano descrito em (2).

### 5. Documentar regressão na memória

Atualizar `mem://ia/lentes-de-contato-orcamento` com o caso "Artur Borges 24/04 15:43" como regressão de **fechamento** (distinto das regressões anteriores, que eram de pré-orçamento). Documentar a regra: pós-escolha de LC → escalonamento para humano fechar a venda.

## Arquivos afetados

- `supabase/functions/ai-triage/index.ts`
- `.lovable/memory/ia/lentes-de-contato-orcamento.md`

## Validação

1. **Marca isolada** ("Acuvue") após orçamento → IA confirma escolha + escala para humano.
2. **Reserva explícita** ("Quero reservar") em contexto LC → IA escala, **não** tenta `agendar_visita`.
3. **Marca + reserva** ("Quero reservar a Acuvue") → IA confirma marca + escala.
4. **Sem opções recentes** ("Acuvue" sem `consultar_lentes_contato` no histórico) → IA pede contexto normalmente, sem escalar à toa.

## Detalhes técnicos

Fluxo final esperado:

```text
consultar_lentes_contato (IA apresenta 2-3 opções)
  -> cliente escolhe marca/modelo OU diz "quero reservar"
    -> detectForcedToolIntent => fechamento_lc
    -> IA: confirma escolha + reforça regra de encomenda/pagamento
    -> escalar_consultor(motivo="fechamento_lentes_contato")
    -> atendimentos.modo = 'humano'
    -> pipeline: mover para coluna de fechamento
    -> eventos_crm: fechamento_lc_escalado
    -> mensagem única ao cliente: "Consultor vai dar continuidade"
```

Pontos no código a ajustar:
- expandir `detectForcedToolIntent` (novo branch `fechamento_lc`)
- novo bloco system prompt: "[FLUXO PÓS-ORÇAMENTO LC — FECHAMENTO COM HUMANO]"
- guardrail antes de `agendar_visita` para não confundir "reservar lente" com "agendar visita"
- guardrail no validador para não cair no pool genérico nesse contexto
- handler para o intent `fechamento_lc` que dispara `escalar_consultor` server-side se o modelo não disparar sozinho
