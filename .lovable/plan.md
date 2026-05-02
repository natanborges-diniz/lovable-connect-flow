# Cadência de retomada (humano) + janela noturna 22h–08h

## O que muda

### 1. Nova cadência humano (templates Meta)

Em `vendas-recuperacao-cron/index.ts`, ramo `processHumano`:

| Fase | Quando | Ação |
|---|---|---|
| 1ª retomada | **4h** sem resposta | Template `retomada_contexto_1` |
| 2ª retomada | **24h** após a 1ª | Template `retomada_contexto_2` |
| Despedida | **4h** após a 2ª | Template `retomada_despedida` + encerra atendimento (modo→ia) + Perdidos |

Defaults atualizados:
- `HUMANO_DELAY_HOURS = [4, 24]` (era `[24, 48]`)
- `HUMANO_FINAL_WAIT_HOURS = 4` (era `24`)
- `HUMANO_MAX_TENTATIVAS = 2`, cooldown 24h (mantidos)

Os campos da UI em **Configurações → Agendamentos Automáticos** (`humano_delay_primeira`, `humano_delay_segunda`, `humano_espera_final`) continuam editáveis — só os valores iniciais mudam.

### 2. Janela noturna: nada sai entre 22:00 e 08:00 (SP)

Regra única para envios outbound automáticos ao cliente:
- **Permitido**: 08:00–21:59 (America/Sao_Paulo), todos os dias.
- **Bloqueado**: 22:00–07:59. Se a hora calculada de envio cair nesse intervalo, **adia para 08:00 do próximo dia** (ou para 08:00 do mesmo dia, se ainda for antes das 8h).
- O contador de tentativa só incrementa quando o template realmente é enviado — o adiamento não consome fase.

Aplicada a:

**a) Templates de retomada** (`vendas-recuperacao-cron`, ramo humano):
- Antes do `fetch` do template, verifica janela. Fora da janela: pula essa execução do cron, registra evento `retomada_adiada_janela_noturna` em `eventos_crm` com o horário previsto de envio. Próxima rodada do cron (5min) re-tenta; quando entrar em 08:00, dispara.
- O lock otimista atual (`ultima_tentativa_at` gravado antes do fetch) só é gravado quando o envio sai — adiamento não toca o contador.

**b) Cadência IA** (`vendas-recuperacao-cron`, ramo IA — 1h/24h/+1h):
- Mesma janela aplicada. Mantém os delays atuais; só atrasa quando cair em 22–08.

**c) Lembretes de agendamento** (`agendamentos-cron`, `processLembreteRetry` e `processLembreteDiaD`):
- Helper hoje permite 08–21h todo dia. Vai virar **08–21:59** com o mesmo helper compartilhado. (Efeito prático: mantém o que já existe; só consolida em uma única função reusada.)

### 3. Helper compartilhado

Criar uma função única em cada edge function (não há "lib" compartilhada entre EFs no Deno deploy, então duplica o helper local em ambas):

```ts
// Janela permitida: 08:00–21:59 America/Sao_Paulo
function dentroDaJanelaEnvio(now: Date): boolean
function proximoSlotEnvio(now: Date): Date  // próxima 08:00 SP
```

Usado em `vendas-recuperacao-cron` (IA + Humano) e `agendamentos-cron` (lembretes).

### 4. Eventos de auditoria

Quando um envio for adiado pela janela:
- `eventos_crm` tipo `retomada_adiada_janela_noturna` (humano e IA)
- `eventos_crm` tipo `lembrete_adiado_janela_noturna` (lembretes)

Metadata inclui: fase prevista, template/lembrete, horário adiado, próximo slot.

### 5. Memória atualizada

- `mem://crm/recuperacao-ia-anti-abandono` — atualizar tabela humano para 4h/24h/+4h e adicionar nota sobre janela noturna 22–08.
- `mem://agendamentos/janela-comunicacao-e-d-day` — alinhar para 08–21:59 (já está nesse range, só consolidar texto).

## Detalhes técnicos

- Timezone calculado via `Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false })` — padrão já usado em `ai-triage` e watchdogs.
- Adiamento NÃO altera `ultima_tentativa_at`; o cron de 5min reentrará assim que cruzar 08:00.
- Cooldown anti-interferência humano (24h após outbound de operador) continua igual.
- Reativação automática IA pós-retomada no `whatsapp-webhook` continua igual.
- Nenhuma migração de banco — só edge functions + memória.

## Fora do escopo

- Não muda templates Meta (continuam `retomada_contexto_1/2` e `retomada_despedida`).
- Não muda colunas elegíveis (Novo Contato, Lead, Orçamento, Qualificado, Retorno).
- Não muda frequência do cron (5min) — só a lógica de quando disparar.
- Não toca em `bot-lojas` / mensagens internas B2B.
- Não muda a janela de **escalada humana** (Seg-Sex 09–18, Sáb 08–12) que controla a mensagem do Gael ao escalar — é janela diferente, sobre outro fluxo.
