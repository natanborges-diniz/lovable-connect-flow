---
name: Oftalmologista — clínicas parceiras + visita à loja
description: Quando cliente pergunta por oftalmologista/exame, IA esclarece que ótica não faz exame por lei, mas indica clínicas parceiras, e oferece visita à loja mais próxima para equipe direcionar.
type: feature
---

# Oftalmologista / Exame de vista — fluxo correto

## Pergunta do cliente
"Vocês têm oftalmologista?" / "Fazem exame de vista?" / "Onde faço exame?"

## Resposta padrão (Gael)
1. Pedir desculpas se houve demora.
2. Esclarecer: **óticas não realizam exame por lei**.
3. Informar que **temos clínicas oftalmológicas parceiras** próximas que indicamos sem compromisso.
4. Sugerir **passar na loja mais próxima** — a equipe direciona para a clínica parceira certa e já aproveita para mostrar armações/lentes.
5. Perguntar **região/bairro** do cliente para sugerir a unidade ideal.

## Proibições
- ❌ NUNCA afirmar que temos oftalmologista na loja.
- ❌ NUNCA disparar template genérico de retomada quando o cliente faz pergunta direta — responder PRIMEIRO.
- ❌ NUNCA mandar o cliente "procurar um oftalmologista" sem oferecer as clínicas parceiras + caminho via loja.

## Erros já observados
- Caso Mi (5511970831864, 2026-04): cliente perguntou "vocês têm oftalmologista?" e o sistema disparou `retomada_contexto_1` (template) em vez de responder. Trata como falha de roteamento — pergunta direta deve ir para `responder` da IA, não para retomada.

## Cadastrado em
- `ia_exemplos`: 2 exemplos categoria `exame_vista`.
- `ia_regras_proibidas`: regra de comportamento (não disparar template em pergunta direta) + regra de informação falsa (sem oftalmologista, com clínicas parceiras).
