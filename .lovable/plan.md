## Diagnóstico — por que a IA voltou a falar no meio do atendimento humano

Eu rastreei a conversa do CLEBER (atendimento `00859d30-…`) no banco e nos eventos. O que aconteceu:

1. `consulta_os` no início escalou para humano corretamente (`modo='humano'`). ✅
2. A operadora **Fran** conduziu o atendimento o dia todo, mas o registro do atendimento ficou com `atendente_nome = NULL` e `atendente_user_id = NULL` o tempo todo. O auto-claim do Atendimentos.tsx **não rodou** (provavelmente porque a Fran respondeu sem abrir o card no modo padrão que dispara o `useEffect` de auto-claim, ou a mutation falhou silenciosamente).
3. Como o cliente ficou em silêncio >4h, o `vendas-recuperacao-cron` disparou `retomada_contexto_1` (cadência humano). Correto, dado o estado visível no banco.
4. Quando o cliente respondeu ("Boa tarde / Não, tudo certo / Obrigado"), o `whatsapp-webhook` rodou o bloco **"REATIVAÇÃO IA pós-template de retomada"** (linhas 711-757 de `whatsapp-webhook/index.ts`):
   - Condições: `modo='humano'` ✅, `atendente_nome IS NULL` ✅ (esse é o gap), `recuperacao_humano.ultima_tentativa_at` recente ✅.
   - Resultado: flipa `modo → 'hibrido'` e libera a IA. Evento `reativacao_ia_pos_retomada` registrado às 19:20:21 e novamente 23:30 → confirmado no `eventos_crm`.
5. Com `modo='hibrido'`, o `ai-triage` processa as inbounds normalmente — daí as 3 mensagens da IA em sequência, a despedida + saudação dupla e, no dia seguinte, as 3 mensagens da IA por cima do "Bom dia" da operadora.

Resumo: a IA não está ignorando o humano. Ela só "vê" um atendimento humano órfão (sem atendente_nome) que respondeu a um template de retomada, e o webhook tem uma regra explícita de reativá-la nesse caso. A regra está certa para o cenário "handoff abandonado", mas está **falhando o diagnóstico** quando o operador trabalhou sem ter ficado registrado como atendente.

## O que vou alterar

### 1. `whatsapp-webhook` — endurecer a checagem de "humano órfão" antes de reativar IA

No bloco de reativação pós-retomada (linhas 711-757), além de `atendente_nome IS NULL`, exigir também que **não exista nenhuma mensagem outbound humana** no atendimento. Hoje a regra confia só no campo `atendente_nome`. Vou adicionar:

- Query rápida em `mensagens` filtrando `atendimento_id`, `direcao='outbound'`, e excluindo `remetente_nome IN ('Assistente IA','Gael','Sistema','Bot Lojas','Recuperação')` (mesma lista já usada em `vendas-recuperacao-cron`).
- Se existir qualquer outbound humano no atendimento → **NÃO reativa IA**. Apenas zera `recuperacao_humano` (como já é feito no branch `else if` da linha 747) e segue o caminho `modo humano → ai-triage skip`.
- Loga o motivo no console para auditoria (`[REATIVACAO-IA] skip: humano já respondeu manualmente`).

Efeito: no caso CLEBER, a Fran enviou várias mensagens como "Operador" → a IA nunca seria reativada e o `ai-triage` continuaria retornando `skipped reason modo humano`.

### 2. `Atendimentos.tsx` — auto-claim no envio (fallback para o useEffect que não rodou)

No `handleSend`, antes de chamar `send-whatsapp`, se o atendimento estiver em `modo='humano'` ou `'hibrido'` e `atendente_user_id` estiver vazio, fazer o claim sincronamente (mesmo helper `useClaimAtendimento`). Isso garante que **qualquer mensagem do operador** registre `atendente_user_id` + `atendente_nome` no atendimento, eliminando o estado órfão que enganou a regra do webhook em primeiro lugar.

### 3. Memória

Atualizar `mem://atendimento/push-operador-humano.md` (ou criar `mem://watchdog/reativacao-ia-pos-retomada.md`) registrando a nova regra: "reativação IA pós-template só dispara se o atendimento não tiver NENHUM outbound humano; envio do operador faz auto-claim como fallback".

## O que **não** vou mexer

- Cadência de retomada (`vendas-recuperacao-cron`) — está correta.
- Comportamento do `ai-triage` em `modo='humano'` — já está correto (skip).
- Bloco silencioso de "Devolver para IA" no Pipeline/Atendimentos — fora do escopo deste bug.

## Verificação

- Reler `whatsapp-webhook/index.ts` após a edição.
- Reproduzir o cenário mentalmente: com pelo menos 1 outbound do "Operador", o bloco de reativação cai no `else if` (só limpa contador) e o `ai-triage` retorna `skipped reason modo humano`. ✅
- Conferir que o auto-claim no envio não dispara duplicado (ref `claimedRef` ou guard `if (!atendimento.atendente_user_id)`).
