---
name: Boleto via CPF Aprovado
description: Fluxo "Gerar Boleto" do Messenger exige Consulta de CPF aprovada prévia; vínculo bidirecional via metadata
type: feature
---

# Boleto vinculado a Consulta de CPF aprovada

## Regra de negócio
A loja só pode solicitar um boleto se houver uma `solicitacoes` com `tipo='consulta_cpf'` e `metadata.resultado_consulta='aprovado'` ainda não vinculada a outro boleto. Sem CPF aprovado, o wizard do Messenger bloqueia e oferece atalho para abrir a Consulta de CPF.

## Onde
Wizard do **InFoco Messenger** em `src/pages/LojaNovaDemanda.tsx` (não é bot — é form que lê `bot_fluxos.etapas[]`). Edge function compartilhada `criar-solicitacao-loja` valida server-side.

## bot_fluxos.gerar_boleto (Atrium)
Etapas reduzidas a apenas `descricao`. Os campos `cpf`, `cliente`, `valor` agora vêm pré-preenchidos da Consulta de CPF selecionada (via UI do Messenger, não via fluxo).

## Vínculo bidirecional
Solicitação de boleto:
- `metadata.consulta_cpf_id` → id da consulta origem
- `metadata.cpf`, `nome_cliente`, `valor_aprovado` herdados

Solicitação de consulta CPF original recebe:
- `metadata.boleto_solicitacao_id`
- `metadata.boleto_gerado_at`

Isso impede reuso e o `CpfApprovalDialog` (Atrium) mostra badge "Boleto já gerado em DD/MM".

## Elegibilidade da lista
- `tipo='consulta_cpf'` + `metadata.resultado_consulta='aprovado'`
- Mesma loja (`metadata.loja_nome` igual ao contexto)
- `created_at` últimos 60 dias
- `metadata.boleto_solicitacao_id IS NULL`

## Implementação
- **Atrium**: bot_fluxos atualizado + badge "Boleto já gerado" em `CpfApprovalDialog.tsx`.
- **Messenger** (executado lá): UI de seleção de CPF aprovado em `LojaNovaDemanda.tsx` + validação e gravação bidirecional em `criar-solicitacao-loja`.
