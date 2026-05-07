# Plano — Fonte de Lead, Retorno e Validação de Contato

## Diagnóstico

Auditei `contatos` (tipo=cliente, 258 totais):

| categoria | qtde |
|---|---|
| site (regex "Acessei o site") | 99 |
| instagram (regex "no Instagram") | 12 |
| sem `fonte_lead` (cai em "Outro" no card) | **147** |

A 1ª inbound dos 147 sem fonte é dominantemente **orgânica** (cumprimentos: "Bom dia", "Olá", "Gostaria de informações", foto de receita) — **não é bug de captura**, é o WhatsApp orgânico (cartão, indicação, busca local, retomadas espontâneas). Hoje não há diferenciação entre **Retorno** (cliente já existia) e **Orgânico novo** — ambos viram "Outro".

Também não há validação ativa do par **telefone+nome**: hoje a IA só chama `registrar_nome_cliente` na 1ª interação quando `nome_confirmado=false`. Em retorno (cliclo ≥ 2) ou contato pré-existente sem confirmação, o nome do banco fica preso ao senderName antigo.

## Objetivo

1. Acabar com a categoria genérica "Outro": separar em **Retorno**, **Orgânico** (novo, sem origem identificada) e **Desconhecido** (corner cases).
2. Sempre que abrir uma nova conversa, validar o par `telefone + nome` com o cliente — confirmar, criar ou atualizar.
3. Auditoria one-shot dos 147 contatos atuais para preencher retroativamente.

## Mudanças

### 1. Webhook — classificação ampliada da fonte (`whatsapp-webhook/index.ts`)

Substituir o bloco `1b. FONTE DO LEAD` por uma cascata determinística aplicada **na 1ª inbound** (rastreada por `metadata.primeira_inbound_at`):

```text
1. "Acessei o site" / link dinizosasco         → site
2. "no Instagram" / "vi vocês no Insta" / bio   → instagram
3. contato pré-existente com atendimento
   anterior encerrado (>0)                       → retorno
4. ciclo_funil ≥ 2                                → retorno
5. tags inclui 'comprador' ou 'lead-recuperado'  → retorno
6. caso contrário                                  → organico
```

Sempre persistir `fonte_lead` (nunca null para clientes finais), `fonte_lead_at`, `fonte_lead_mensagem`. Para `retorno`, gravar também `fonte_lead_origem_anterior` (a `fonte_lead` que tinha antes, se houver) e `retorno_apos_dias`.

### 2. Validação obrigatória do par telefone+nome

Reforçar `whatsapp-webhook` + `ai-triage`:

- **No webhook (já existe parcialmente)**: ao localizar/criar `contatos` por `telefone`, se `nome` estiver vazio, igual ao telefone, ou for genérico ("Cliente", "WhatsApp User", começa com "+55"), marcar `metadata.nome_confirmado=false` e `metadata.precisa_confirmar_nome=true`.
- **No `ai-triage`**: se `precisa_confirmar_nome=true` (independe de ser 1ª interação), o Gael pergunta **uma vez** "Falo com {senderName}?" (ou "Posso saber seu nome?"). A resposta dispara a tool `registrar_nome_cliente` (já existente), que faz `UPDATE contatos SET nome` e zera os flags.
- Para contatos já confirmados onde o `senderName` mudou (cliente trocou de aparelho/perfil), gravar discrepância em `metadata.nomes_alternativos[]` mas **não** sobrescrever automaticamente.

### 3. Regra: Retorno reabre, não duplica

`whatsapp-webhook` já faz upsert por telefone (PK lógica). Acrescentar: quando contato pré-existente recebe nova inbound após `>14 dias` da última mensagem, registrar evento `retomada_espontanea` em `eventos_crm` e incrementar `contatos.ciclo_funil`. Isso alimenta a regra 4 acima já no próximo lead que vier.

### 4. Dashboard — card "Origem dos Leads"

`useFonteLeads.ts` + `FonteLeadsCard.tsx`:

- 4 categorias: **Site**, **Instagram**, **Retorno**, **Orgânico** (+ "Desconhecido" se houver legado sem fonte).
- KPI extra: `% retorno` (saúde da base) e `dias médios até retorno`.
- Donut com 4 fatias e cor distinta para Retorno (azul/violeta).

### 5. Backfill one-shot

Migration de dados (INSERT em `contatos.metadata`) varrendo os 147 atuais:
- Se contato tem ≥ 2 atendimentos OU `ciclo_funil ≥ 2` OU tag `comprador` → `fonte_lead='retorno'`
- Senão → `fonte_lead='organico'`
- Marcar `metadata.fonte_lead_backfill_v2=true` para distinguir do backfill anterior.

### 6. Memória

Atualizar `mem://crm/fonte-lead-tracking.md` com as novas categorias, cascata e a regra de validação de nome. Atualizar `mem://index.md` apontando o item.

## Fora de escopo

- Detecção avançada por UTM/short-link (exigiria integração Meta Click-to-WhatsApp Ads).
- Reescrita do componente UI além das 4 fatias e KPI.

## Arquivos tocados

- `supabase/functions/whatsapp-webhook/index.ts` (cascata + validação nome + retomada)
- `supabase/functions/ai-triage/index.ts` (gate `precisa_confirmar_nome`)
- `src/hooks/useFonteLeads.ts` (4 categorias)
- `src/components/dashboard/FonteLeadsCard.tsx` (donut + KPI retorno)
- `.lovable/memory/crm/fonte-lead-tracking.md` (rewrite)
- `.lovable/memory/index.md` (entry refresh)
- 1 INSERT-migration de backfill
