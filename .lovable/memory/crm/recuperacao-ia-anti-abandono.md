---
name: Recuperação anti-abandono — cadência IA + cadência Humano
description: vendas-recuperacao-cron monitora inatividade no CRM. Cadência IA 1h→24h→despedida. Cadência humano 24h→48h→despedida via templates Meta, com cooldown de 24h se consultor ativo.
type: feature
---

# Recuperação anti-abandono (CRM Vendas)

`vendas-recuperacao-cron` varre periodicamente cards do CRM em colunas elegíveis (Novo Contato, Lead, Orçamento, Qualificado, Retorno) e dispara retomadas contextuais quando o cliente para de responder. Trata **dois fluxos paralelos** conforme o `atendimento.modo`.

## Fluxo IA (modo='ia')

| Fase | Quando | Ação |
|---|---|---|
| 1ª retomada | **1h** sem resposta | IA via `responder-solicitacao` modo recuperacao |
| 2ª retomada | **24h** após a 1ª | IA com `is_final=true` |
| Despedida | **1h** após a 2ª | Mensagem fixa via `send-whatsapp` + Perdidos |

Total: ~26h. Contador em `contatos.metadata.recuperacao_vendas`.

## Fluxo Humano (modo='humano' ou 'hibrido')

Disparado quando cliente fica inerte após handoff para humano. Como tipicamente está fora da janela de 24h da Meta, **usa exclusivamente templates aprovados** (`retomada_contexto_1`, `retomada_contexto_2`, `retomada_despedida`).

| Fase | Quando | Ação | Canal |
|---|---|---|---|
| Alerta interno | 6h sem resposta | Notificação in-app ao operador | in-app |
| 1ª retomada | **24h** sem resposta E sem outbound humano nas últimas 24h | Template `retomada_contexto_1` | WhatsApp Meta |
| 2ª retomada | **48h** após a 1ª | Template `retomada_contexto_2` | WhatsApp Meta |
| Despedida | **24h** após a 2ª | Template `retomada_despedida` + encerra atendimento (modo→ia) + Perdidos | WhatsApp Meta |

Total: ~96h. Contador em `atendimentos.metadata.recuperacao_humano` (separado do contador IA).

### Cooldown anti-interferência (humano)
Se houve outbound de remetente humano (não-Gael/IA/Sistema/Bot/Template) nas últimas **24h**, o cron pula a retomada — assume que o consultor está conduzindo. Configurável via `humano_cooldown_horas`.

### Inferência do tópico ({{2}})
Função `inferirTopico` analisa últimas 5 outbound humanas em busca de palavras-chave:
- "lentes de contato" → `"as lentes de contato"`
- "orçamento/preço/valor" → `"seu orçamento"`
- "agendar/visita/horário" → `"sua visita à loja"`
- "receita/grau/exame" → `"sua receita"`
- "armação/óculos/modelo" → `"seus óculos"`
- "multifocal/progressivo" → `"suas lentes multifocais"`
- fallback → `"seu atendimento"`

### Fallback manual
O componente `ReconectarTemplateButton.tsx` permite ao operador disparar template manualmente a qualquer momento depois das 24h. A automação cobre o caso "operador esqueceu".

## Defaults configuráveis (`vendas-recuperacao-cron/index.ts`)

```ts
// IA
DELAY_HOURS = [1, 24]
FINAL_WAIT_HOURS = 1
MAX_TENTATIVAS = 2

// Humano
HUMANO_DELAY_HOURS = [24, 48]
HUMANO_FINAL_WAIT_HOURS = 24
HUMANO_MAX_TENTATIVAS = 2
HUMANO_COOLDOWN_HORAS = 24
```

Todos overridáveis via payload do cron em **Configurações → Agendamentos Automáticos** (`humano_delay_primeira`, `humano_delay_segunda`, `humano_espera_final`, `humano_max_tentativas`, `humano_cooldown_horas`).

## Eventos registrados em `eventos_crm`
- `recuperacao_tentativa` (IA)
- `lead_despedida_final` (IA)
- `recuperacao_humano_tentativa` (Humano) — com template e tópico no metadata
- `lead_despedida_humano` (Humano)
