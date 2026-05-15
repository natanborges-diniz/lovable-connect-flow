## Por que a Franciana ainda aparece em "Lembrete Enviado" no Pipeline Lojas

`/lojas` (`PipelineAgendamentos.tsx`) é alimentado por `useAgendamentos`, que lista **todos** os registros de `agendamentos` agrupados por `status`. O card só some da coluna ativa quando o registro vai para `cancelado` (ou outro status terminal).

No banco, o registro da Fran está assim:

```text
id:           e595e7dd-4881-4816-97d6-7b75d8d9b4e7
status:       lembrete_enviado          ← deveria ser "cancelado"
data_horario: 2026-05-15 20:30 UTC (17:30 SP — hoje)
loja_nome:    DINIZ PRIMITIVA I
metadata:     { lembrete_ok, aviso_loja_novo_at, ... }   ← sem "cancelado_em"
```

A Gael respondeu "cancelei seu horário" no chat, mas **não chamou nenhuma tool** que altere `agendamentos`. A tool `cancelar_visita` só foi adicionada ao `ai-triage` no deploy de hoje à noite — a conversa da Fran aconteceu antes. Então o card continua vivo na coluna "Lembrete Enviado".

A varredura no banco confirma que **ela é o único caso ativo** com pedido de cancelamento na conversa (`desmarc/cancel/não vou`). Ou seja: não há histórico antigo a limpar, só esse registro.

## O que vou fazer

### 1. Corrigir o registro da Franciana
Atualizar o agendamento `e595e7dd-…` para refletir o cancelamento real:
- `status = 'cancelado'`
- `metadata` recebe `cancelado_em`, `cancelado_por: 'cliente'`, `cancelado_motivo: 'Cliente informou que desmarcou e não poderá comparecer'`, `cancelado_origem: 'correcao_manual_admin'`
- Inserir evento em `eventos_crm` (`tipo='agendamento_cancelado_cliente'`, referenciando o agendamento)

Efeito: o card sai imediatamente das colunas "Lembrete Enviado" e cai em "Cancelado" no Pipeline Lojas.

### 2. Varredura recorrente (cron leve)
A nova tool `cancelar_visita` só pega cancelamentos a partir de agora. Para casos onde a IA falha em chamar a tool (falha de rede, regressão de prompt, conversa via humano sem mexer no card), proponho um cron diário **detector-cancelamento-orfao** (executa 1x/h):

- Varre `agendamentos` com `status IN ('agendado','lembrete_enviado','confirmado')` e `data_horario` entre `now()-12h` e `now()+24h`.
- Para cada um, olha últimas 10 mensagens do atendimento. Se houver inbound recente (`<24h`) com regex de cancelamento (`desmarc|cancel|n[ãa]o (vou|poderei|consigo|posso) ir|n[ãa]o vai dar`) **e** outbound posterior do bot reconhecendo o cancelamento (regex `cancelei|cancelado|tudo certo.*desmarc`), marca como `cancelado` com `metadata.cancelado_origem='watchdog_cancelamento'` + evento em `eventos_crm`.
- Se houver só inbound de cancelamento sem reconhecimento do bot, **não cancela sozinho** — cria notificação para o setor da loja revisar (evita falso positivo tipo "não vou conseguir antes das 17h, prefiro 18h").

Isso usa a infraestrutura existente (`cron_jobs` + edge function), igual aos outros watchdogs (`watchdog-inbound-orfao`, `watchdog-loop-ia`).

### 3. Indicador visual no card (opcional, mas recomendado)
No `PipelineAgendamentos.tsx`, exibir um badge âmbar `⚠ Pedido de cancelamento` quando `metadata.pedido_cancelamento_detectado_at` estiver setado (preenchido pelo watchdog quando ele detecta intent mas não fecha sozinho). Permite a loja agir antes do cliente faltar.

## Detalhes técnicos

**Arquivos novos:**
- `supabase/functions/watchdog-cancelamento-orfao/index.ts`
- `mem://watchdog/cancelamento-orfao.md`

**Arquivos editados:**
- `src/pages/PipelineAgendamentos.tsx` (badge no card)
- `mem://index.md` (referência ao novo watchdog)

**SQL via insert tool (não migração):**
- UPDATE no agendamento da Fran
- INSERT em `eventos_crm`
- INSERT em `cron_jobs` (registrar o novo watchdog, expressao `*/15 * * * *` — verifica a cada 15min só na janela próxima do atendimento)
- `cron.schedule` via `net.http_post` para o novo watchdog

**Fora do escopo:** não mexer em `vendas-recuperacao-cron`, `agendamentos-cron`, `pipeline-automations`, nem na nova tool `cancelar_visita` já existente.
