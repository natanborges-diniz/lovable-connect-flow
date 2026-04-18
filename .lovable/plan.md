

## Cadência final (consolidando todos os pedidos)

| Fase | Quando | Ação |
|---|---|---|
| 1ª retomada | **1h** sem resposta do cliente | IA dispara retomada contextual |
| 2ª retomada | **24h** após a 1ª | IA dispara retomada (tom mais direto) |
| Mensagem de despedida | **1h** após a 2ª (sem resposta) | Mensagem fixa de agradecimento + move para Perdidos |

A 3ª tentativa é eliminada. A despedida vira o **passo final** (não é "tentativa de recuperação", é encerramento educado).

## Mensagem de despedida (texto fixo)

> "Olá {primeiro_nome}! 😊 Agradeço muito o seu contato com as Óticas Diniz Osasco. Não quero te incomodar, então vou encerrar nossa conversa por aqui. Qualquer dúvida que surgir — sobre lentes, armações, agendamento ou orçamento — é só me chamar de volta, estou à disposição. Tenha um ótimo dia! ✨"

Enviada via `send-whatsapp` (Evolution, mantém continuidade do canal), remetente "Gael".

## Mudanças no código

### 1. `supabase/functions/vendas-recuperacao-cron/index.ts`

**Defaults (linhas 27-33):**
```ts
const DELAY_HOURS = [
  payload.delay_primeira_tentativa ?? 1,    // 48 → 1
  payload.delay_segunda_tentativa ?? 24,    // 72 → 24
];
const FINAL_WAIT_HOURS = payload.espera_final ?? 1;  // 72 → 1 (despedida 1h após 2ª)
const MAX_TENTATIVAS = payload.max_tentativas ?? 2;  // 3 → 2
```
Remover `delay_terceira_tentativa`.

**Bloco de encerramento (linhas 204-228):** quando `tentativas >= MAX_TENTATIVAS` (=2) e passou `FINAL_WAIT_HOURS` (=1h):
- Enviar a mensagem de despedida via `send-whatsapp` (NÃO via IA — texto fixo)
- Encerrar atendimento (`status=encerrado`)
- Mover para Perdidos
- Registrar `eventos_crm` tipo `lead_despedida_final` com o texto enviado

### 2. Configurações UI (`src/components/configuracoes/CronJobsCard.tsx` e/ou `RecuperacaoCard.tsx`)

Atualizar o formulário do cron `vendas-recuperacao-cron`:
- Remover campo "delay terceira tentativa"
- Renomear "espera final" → "espera para despedida (h)"
- Atualizar defaults exibidos (1, 24, 1, max=2)

### 3. Memória

Atualizar `mem://crm/recuperacao-ia-anti-abandono.md`:
- Cadência nova: 1h → 24h → despedida 1h depois → Perdidos
- Total: 2 tentativas IA + 1 mensagem fixa de encerramento
- Sem 3ª tentativa

### 4. Atualizar entrada Core no `mem://index.md`
Trocar referência "48h, 3 tentativas" pela nova cadência reduzida.

## Sem mudanças necessárias
- `cron_jobs` no banco: defaults novos no código já cobrem; UI permite override por job.
- Tabelas: nenhuma migração.
- Outras EFs: nenhuma alteração.

## Resultado
Cliente que parar de responder recebe 2 retomadas rápidas (1h, depois 24h) e, persistindo o silêncio, uma mensagem cordial de encerramento 1h depois — total ~26h do silêncio até Perdidos, contra 192h+ atuais. Tom final é positivo e abre a porta para retorno espontâneo.
