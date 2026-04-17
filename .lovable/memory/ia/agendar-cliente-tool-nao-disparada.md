---
name: Tool agendar_cliente nem sempre é chamada
description: IA confirma data/hora/loja em texto mas não invoca a tool agendar_cliente — agendamento não é persistido nem entra em automações
type: feature
---

## Sintoma observado em produção (17/04/2026)

Diversas conversas em que a IA escreve "agendamento confirmado", "vou reservar", "te esperamos amanhã às 14h" etc., mas:

- Não há registro em `public.agendamentos`
- Contato fica na coluna "Agendamento" do pipeline Lojas (movido pela coluna_pipeline na resposta) **sem** linha em `agendamentos`
- Como não existe agendamento, **nenhuma automação dispara**: lembrete cliente, confirmação loja, no-show, recuperação
- Cliente percebe "agendou mas ninguém me lembrou"

Casos detectados em 17/04: Tania Figueiredo, Rodrigo Vidal, Victória Melo, Rachel, Carla Teixeira (todos foram para coluna "Agendamento" sem registro).

## Causa raiz

`ai-triage` confia que o LLM escolha a tool `agendar_cliente` quando o cliente confirma. Mas:

1. O modelo frequentemente prefere `responder` com texto natural ("vou reservar 10h") sem invocar a tool.
2. Sem `agendar_cliente`, não existe linha em `agendamentos` → trigger `on_agendamento_status_change` nunca dispara → `pipeline-automations` (entidade=agendamento) nunca executa → sem lembrete/confirmação/no-show/recuperação.
3. A coluna do contato muda só pelo `coluna_pipeline` retornado no JSON, que move o card visualmente mas é puramente cosmético.

## Regra

Sempre que a IA produzir resposta com **data + hora + loja** em contexto de agendamento (intent=agendamento), **forçar** chamada de `agendar_cliente` antes de enviar a resposta ao cliente. Se faltar algum dos 3 dados, NÃO mover coluna para "Agendamento" — manter em "Qualificado/Orçamento" e perguntar o que falta.

## Verificação

```sql
SELECT c.nome, pc.nome as coluna, EXISTS(SELECT 1 FROM agendamentos WHERE contato_id=c.id) tem_ag
FROM contatos c
JOIN pipeline_colunas pc ON pc.id=c.pipeline_coluna_id
WHERE pc.nome='Agendamento' AND NOT EXISTS(SELECT 1 FROM agendamentos WHERE contato_id=c.id);
```
Deve retornar zero linhas.
