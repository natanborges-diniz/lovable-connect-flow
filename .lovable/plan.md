

# Descrições Detalhadas + Parâmetros Configuráveis nos Crons

## Objetivo

Transformar a tela de crons de uma tabela técnica em um painel informativo e configurável, onde cada cron mostra em linguagem simples o que faz, permite expandir o fluxo completo, e permite ajustar os parâmetros operacionais (tempos, tentativas, etc.) sem mexer em código.

## Mudanças

### 1. Dicionário de descrições e fluxos por função (front-end)

Criar um mapa `CRON_DETAILS` indexado por `funcao_alvo` contendo:
- `resumo`: frase curta em português simples
- `fluxo`: array de etapas descrevendo o passo-a-passo
- `parametros`: lista de parâmetros configuráveis com nome, label, tipo (number/select), valor default, e unidade

Exemplo para `agendamentos-cron`:
- Resumo: "Gerencia o ciclo de vida dos agendamentos nas lojas"
- Fluxo: 7 etapas (lembrete 24h antes, 2a tentativa, cobranca loja, 2a cobranca, timeout, cobranças agendadas, abandono)
- Parâmetros: horas para 2a tentativa de lembrete (4h), horas para 2a cobrança loja (3h), horas timeout loja (6h), horas para abandono (48h), max tentativas recuperação (2)

Exemplo para `vendas-recuperacao-cron`:
- Resumo: "Recupera leads inativos no pipeline de vendas via IA"
- Fluxo: 5 etapas (detecta inatividade, 1a msg IA em 48h, 2a em 72h, 3a em 72h, move para Perdidos)
- Parâmetros: delay 1a tentativa (48h), delay 2a (72h), delay 3a (72h), espera final (72h), max tentativas (3), colunas elegíveis

### 2. Redesign do CronJobsCard (front-end)

Substituir a tabela por cards individuais por cron, cada um contendo:
- Header com nome, badge de status (ativo/inativo), switch, e botões de ação
- Resumo em texto simples sempre visível
- Collapsible "Ver fluxo completo" que mostra as etapas numeradas com ícones
- Collapsible "Configurar parâmetros" que mostra inputs editáveis para os valores configuráveis
- Botão "Salvar parâmetros" que grava os valores no campo `payload` do cron_job

### 3. Edge functions leem parâmetros do payload (back-end)

Atualizar `agendamentos-cron` e `vendas-recuperacao-cron` para ler os tempos/thresholds do `payload` recebido (que vem do `cron_jobs.payload`), usando os valores atuais como fallback default. Exemplo:
```typescript
const DELAY_HOURS_1 = payload?.delay_primeira_tentativa ?? 48;
```

### 4. Migração de dados

Nenhuma migração de banco necessária. O campo `payload` (jsonb) já existe e será usado para armazenar os parâmetros configuráveis.

## Arquivos Modificados

| Arquivo | Mudança |
|---------|---------|
| `src/components/configuracoes/CronJobsCard.tsx` | Redesign completo: cards com descrições, fluxo expandível, e painel de parâmetros configuráveis |
| `supabase/functions/agendamentos-cron/index.ts` | Ler parâmetros do payload em vez de constantes hardcoded |
| `supabase/functions/vendas-recuperacao-cron/index.ts` | Ler parâmetros do payload em vez de constantes hardcoded |

## Detalhes Técnicos

- Os parâmetros são salvos via `manage-cron-jobs` action `update`, que já atualiza o `payload`
- O `manage-cron-jobs` já repassa o `payload` na chamada HTTP do pg_cron, então as edge functions já recebem esses valores
- Para crons desconhecidos (criados manualmente), mantém a visualização atual em formato tabela

