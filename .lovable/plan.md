

## Diagnóstico

Quando operador devolve card humano→IA, hoje:
1. IA não dispara automaticamente — espera nova mensagem do cliente
2. Quando dispara, fallback genérico ("Quer que eu retome?") quando contexto está confuso
3. Pode escalar de novo pra humano por inércia, mesmo o humano tendo decidido devolver pra IA continuar

O usuário quer: ao devolver pra IA, ela **lê as últimas mensagens, identifica intenção pendente do cliente (agendamento, preço, endereço…) e continua naturalmente** — sem mensagem pronta, sem re-escalar exceto se surgir nova necessidade humana legítima no desenrolar.

## Solução: Continuidade Inteligente pós-devolução

### 1. Trigger automático humano→IA
No `Pipeline.tsx` / `Atendimentos.tsx`, quando `modo` muda de `humano`/`hibrido` → `ia`, disparar imediatamente:
```ts
supabase.functions.invoke('ai-triage', {
  body: { atendimento_id, forcar_processamento: true, motivo_disparo: 'devolucao_humano_ia' }
})
```

### 2. Contexto de continuidade no `ai-triage`
Quando `motivo_disparo === 'devolucao_humano_ia'`, injetar prompt de sistema:
```
[CONTEXTO: DEVOLUÇÃO HUMANO→IA]
O operador humano devolveu a conversa para você continuar.
- Analise as últimas 10 mensagens e identifique a INTENÇÃO PENDENTE do cliente
  (ex: agendar, pedir preço, endereço, confirmar horário, tirar dúvida sobre receita)
- Continue NATURALMENTE de onde parou, sem reapresentação, sem "Quer que eu retome?"
- NÃO escale para humano novamente, exceto se:
  a) Surgir reclamação grave nova
  b) Cliente pedir explicitamente "falar com humano" de novo
  c) Houver bloqueio técnico real (ex: receita ilegível após tentativa)
- Se houver imagem não interpretada nas últimas 5 inbound, priorize `interpretar_receita`
- Se houver pedido objetivo pendente (data/hora/loja), execute a tool correspondente
  (`agendar_cliente`, `responder` com info da loja, etc.)
```

### 3. Bloqueio anti-reescalar
No validador pós-LLM:
- Se `motivo_disparo === 'devolucao_humano_ia'` e tool escolhida === `escalar_consultor`
- Verificar se motivo da escalada é "novo" (reclamação, pedido explícito) ou herdado do histórico anterior
- Se herdado → forçar 2ª tentativa com prompt: "Você foi devolvido pela equipe humana. Não escale pelo mesmo motivo já tratado. Responda a intenção pendente."

### 4. Detector de intenção pendente (heurística)
Função local que escaneia últimas 5 inbound buscando sinais:
- `agendar|marcar|horário|amanhã|hoje` → intent: `scheduling`
- `preço|valor|orçamento|quanto` + receita em metadata → intent: `quote`
- `endereço|onde fica|como chegar` → intent: `location`
- `imagem inbound sem entry em metadata.receitas` → intent: `prescription_pending`

Esses intents são injetados no prompt como "INTENÇÃO PENDENTE DETECTADA: X" para forçar foco.

## Arquivos

| Arquivo | Mudança |
|---------|---------|
| `supabase/functions/ai-triage/index.ts` | Aceitar `motivo_disparo`, injetar contexto de devolução, detectar intent pendente, bloquear re-escalação herdada |
| `src/pages/Pipeline.tsx` | Detectar mudança `modo: humano→ia` no update do card e disparar `ai-triage` com `motivo_disparo: 'devolucao_humano_ia'` |
| `src/pages/Atendimentos.tsx` | Mesma lógica no toggle de modo da tela de atendimento |
| `mem://ia/continuidade-pos-devolucao-humano` (novo) | Documentar regra: devolução humano→IA dispara continuidade contextual, não reescala por motivo herdado |

## O que NÃO muda
- Fluxo normal de mensagem nova do cliente continua igual
- Lógica de prioridade de receita não lida (já implementada) permanece
- Modo híbrido não dispara — só humano→ia explícito
- IA pode escalar novamente, mas só por motivo NOVO surgido após devolução

## Salvaguardas
- Disparo único: marca `metadata.last_devolucao_trigger_at`, ignora se < 30s
- Log em `eventos_crm` tipo `ia_continuidade_pos_devolucao` com intent detectada
- Se IA não conseguir identificar intenção (últimas mensagens vagas), responde curto e contextual ("Voltei pra te ajudar — em que posso continuar?") em vez de escalar

