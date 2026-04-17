---
name: Fila de Atendimento Humano — exclusões e saneamento
description: Fila humana no CRM lista atendimentos modo='humano' EXCLUINDO contatos corporativos (loja/colaborador/fornecedor). Saneamento corporativo automático via trigger telefones_lojas + bloco isCorporate no whatsapp-webhook + função sanitize_corporate_contact.
type: feature
---

## Fila Humana (CRM /crm)
Localização: `src/pages/Pipeline.tsx` (linhas ~366-431). Lista cards onde `atendimento.modo === 'humano'` ordenados por tempo de espera, com badge pulsante quando há resposta nova do cliente.

### Filtro de exclusão (obrigatório)
Excluir contatos corporativos — eles são atendidos pelo `bot-lojas`, não pela fila humana:
```ts
if (c.tipo && c.tipo !== "cliente") return false;
```

## Saneamento Corporativo Automático

Garante que números cadastrados em `telefones_lojas` nunca apareçam na fila humana mesmo se foram criados antes como cliente.

### 3 camadas de defesa

1. **Trigger `trg_on_telefone_loja_change`** — dispara `sanitize_corporate_contact(telefone)` ao INSERT/UPDATE em `telefones_lojas` (mudança de ativo, telefone ou tipo). Saneia imediatamente ao cadastrar.
2. **Webhook `whatsapp-webhook` bloco `isCorporate`** (linhas ~138-194) — toda mensagem inbound de número corporativo: limpa `pipeline_coluna_id` se não for do setor corporativo, define `setor_destino = 32cbd99c-4b20-4c8b-b7b2-901904d0aff6` (Atendimento Corporativo), encerra atendimentos `modo='humano' AND atendente_nome IS NULL` (órfãos do bot).
3. **UI filter** — Pipeline.tsx exclui visualmente.

### Função `sanitize_corporate_contact(telefone)`
SECURITY DEFINER. Executa em qualquer contato com aquele telefone:
- Limpa `pipeline_coluna_id` se a coluna NÃO pertence ao setor corporativo (`32cbd99c...`).
- Define `setor_destino` corporativo.
- Atualiza `tipo` (loja/colaborador) conforme `telefones_lojas.tipo`.
- Encerra atendimentos abertos em `modo='humano'` SEM `atendente_nome`.
- Loga em `eventos_crm` como `reclassificacao_corporativa`.

## IDs de referência
- Setor "Atendimento Corporativo" (Interno): `32cbd99c-4b20-4c8b-b7b2-901904d0aff6`
- CRM Vendas: colunas com `setor_id IS NULL`
