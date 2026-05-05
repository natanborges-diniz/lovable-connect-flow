## Problema

Na conversa da Franciana, a despedida final ficou:

> "Combinado, Fran! Te espero **segunda-feira, 04/05 às 17:30 na DINIZ ANTONIO AGU** 👋"

quando o agendamento real era **quarta 06/05 às 15:00 no Super Shopping**.

## Causa

A cliente tem 2 agendamentos no banco:
- **Antônio Agú** — 04/05 17:30, status `confirmado` (antigo, já passou)
- **Super Shopping** — 06/05 15:00, status `lembrete_enviado` (atual, recém-lembrado pelo cron dia-D)

Em `supabase/functions/ai-triage/index.ts`:

1. **Linha 1795** — query traz os 5 agendamentos ordenados por `data_horario DESC` e inclui status `lembrete_enviado`. OK.

2. **Linha 2196** — escolha do "agendamento ativo" para popular `agendamentoFmt`:
   ```ts
   const agAtivoRecentEarly = (agendamentosAtivos || [])
     .find(a => ["agendado","confirmado"].includes(a.status))
     || (agendamentosAtivos || [])[0];
   ```
   Bug: `lembrete_enviado` **não está** na lista do `.find()`. Resultado: o filtro pula o agendamento de quarta (status `lembrete_enviado`) e casa com o de segunda (`confirmado` antigo). Ainda que casasse, não há filtro temporal — agendamento passado entra como "ativo".

3. Como toda a lógica de despedida (`isThanksClose`, `isShortNoToHelp`, `isExplicitClose`, hint de agendamento ativo) usa `agendamentoFmt`, a IA assinou com o agendamento errado.

## Correção

Editar `supabase/functions/ai-triage/index.ts` linhas 2195-2197 para:

1. Considerar `lembrete_enviado` como agendamento ativo (mesmo nível de `agendado`/`confirmado`).
2. Ignorar agendamentos cujo `data_horario` já passou (com tolerância de algumas horas para casos dia-D ainda em andamento).
3. Escolher o **mais próximo no futuro** (menor `data_horario` ≥ agora ou recente), não o primeiro retornado pelo banco.

Algoritmo:
```ts
const NOW_MS = Date.now();
const TOLERANCIA_MS = 6 * 3600 * 1000; // 6h: ainda válido se agendamento foi hoje cedo
const ATIVOS_STATUS = ["agendado", "confirmado", "lembrete_enviado"];

const agendamentosFuturos = (agendamentosAtivos || [])
  .filter(a => ATIVOS_STATUS.includes(a.status))
  .filter(a => {
    if (!a.data_horario) return false;
    return new Date(a.data_horario).getTime() >= (NOW_MS - TOLERANCIA_MS);
  })
  .sort((x, y) => new Date(x.data_horario).getTime() - new Date(y.data_horario).getTime());

const agAtivoRecentEarly = agendamentosFuturos[0]
  || (agendamentosAtivos || []).find(a => ATIVOS_STATUS.includes(a.status))
  || (agendamentosAtivos || [])[0];
```

Mantém fallback caso nenhum esteja no futuro (para não quebrar fluxos antigos).

## Validação

- Cenário Fran: futuros = [Super Shopping 06/05]; antigo Antônio Agú 04/05 fica filtrado → `agendamentoFmt` = "quarta-feira, 06/05 às 15:00 na DINIZ SUPER SHOPPING". ✅
- Cliente com apenas 1 agendamento futuro `agendado` → mesmo comportamento de hoje.
- Cliente com agendamento passado `confirmado` e nenhum futuro → fallback retorna o passado (não regride).
- Cliente sem agendamentos → `hasAgendamentoAtivo = false`, despedida sem horário.

## Arquivo alterado

- `supabase/functions/ai-triage/index.ts` — 1 edição localizada (linhas 2195-2197).

Sem migrations, sem mudanças de UI, sem novos secrets.

## Memória

Atualizar `mem://ia/agendamento-ativo-anti-duplicacao` adicionando: "Seleção do agendamento ativo prioriza agendamento FUTURO (data_horario ≥ now − 6h) ordenado crescente; status `lembrete_enviado` conta como ativo junto com `agendado`/`confirmado`. Evita assinar despedida com agendamento passado quando há outro futuro."
