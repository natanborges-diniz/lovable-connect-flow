---
name: Recuperação anti-abandono — cadência IA + cadência Humano
description: vendas-recuperacao-cron monitora inatividade no CRM. Cadência IA 1h→24h→despedida 1h. Cadência humano 4h→24h→despedida 4h via templates Meta. Janela de envio 08–22h SP.
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
| 1ª retomada | **4h** sem resposta E sem outbound humano nas últimas 24h | Template `retomada_contexto_1` | WhatsApp Meta |
| 2ª retomada | **24h** após a 1ª | Template `retomada_contexto_2` | WhatsApp Meta |
| Despedida | **4h** após a 2ª | Template `retomada_despedida` + encerra atendimento (modo→ia) + Perdidos | WhatsApp Meta |

Total: ~32h. Contador em `atendimentos.metadata.recuperacao_humano` (separado do contador IA).

## Janela noturna 22h–08h (SP)

Helper `dentroDaJanelaEnvio(now)` em `vendas-recuperacao-cron/index.ts` libera envio entre 08:00 e 21:59 (America/Sao_Paulo). Aplicado em **ambos os ramos** (IA e Humano) e em **todas as fases** (1ª, 2ª e despedida):

- Se a hora calculada cair entre 22:00–07:59, a execução é **pulada** e registra `retomada_adiada_janela_noturna` em `eventos_crm` com a fase pretendida.
- O lock otimista (`ultima_tentativa_at`) e o contador de tentativas **só são gravados quando o envio sai** — o adiamento não consome fase.
- O cron de 5min reentra naturalmente; assim que cruza 08:00, dispara.

Helper análogo `dentroDeJanelaComunicacaoCliente(now)` em `agendamentos-cron/index.ts` (mesma janela 08–22) bloqueia lembretes de agendamento fora desse intervalo.

### Cooldown anti-interferência (humano)
Se houve outbound de remetente humano (não-Gael/IA/Sistema/Bot/Template) nas últimas **24h**, o cron pula a retomada — assume que o consultor está conduzindo. Configurável via `humano_cooldown_horas`.

### Idempotência (anti-duplicação por race do cron)
Antes de disparar o template, `processHumano` verifica `recuperacao_humano.ultima_tentativa_at`: se foi gravada nos últimos 60min, pula. Logo em seguida, **grava o novo `ultima_tentativa_at` ANTES do `fetch`** (lock otimista), garantindo que duas execuções concorrentes do cron não disparem o template duas vezes.

### Reativação automática IA pós-retomada (`whatsapp-webhook`)
Quando o cliente responde a um template de retomada estando o atendimento em `modo='humano'` órfão (sem `atendente_nome`), o webhook automaticamente:
1. Flipa `modo` para `hibrido` (mantém card visível na fila humana, mas IA processa).
2. Limpa `recuperacao_humano` do metadata.
3. Roteia o inbound para `ai-triage` no mesmo request.

### Inferência do tópico ({{2}})
Função `inferirTopico` analisa últimas 5 outbound humanas em busca de palavras-chave (lentes de contato → orçamento → agendar → receita → armação → multifocal → fallback "seu atendimento").

### Fallback manual
O componente `ReconectarTemplateButton.tsx` permite ao operador disparar template manualmente após 24h.

## Defaults configuráveis (`vendas-recuperacao-cron/index.ts`)

```ts
// IA
DELAY_HOURS = [1, 24]
FINAL_WAIT_HOURS = 1
MAX_TENTATIVAS = 2

// Humano (atualizado: 4h/24h/+4h despedida)
HUMANO_DELAY_HOURS = [4, 24]
HUMANO_FINAL_WAIT_HOURS = 4
HUMANO_MAX_TENTATIVAS = 2
HUMANO_COOLDOWN_HORAS = 24
```

Todos overridáveis via payload do cron em **Configurações → Agendamentos Automáticos** (`humano_delay_primeira`, `humano_delay_segunda`, `humano_espera_final`, `humano_max_tentativas`, `humano_cooldown_horas`).

## Eventos registrados em `eventos_crm`
- `recuperacao_tentativa` (IA)
- `lead_despedida_final` (IA)
- `recuperacao_humano_tentativa` (Humano)
- `lead_despedida_humano` (Humano)
- `retomada_adiada_janela_noturna` (IA + Humano, quando envio cai em 22h–08h)
