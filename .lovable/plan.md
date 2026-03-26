

## Plano: Temporalidade Dinâmica nas Mensagens de Lembrete

### Problema

Quando o card vai para `lembrete_enviado` (automaticamente pelo cron OU manualmente), a mensagem de lembrete usa variáveis fixas como `{{data}}` que mostram "28/03/2026" — sem contexto temporal. O cliente precisa ler "amanhã às 10h", "hoje às 14h", ou "sábado às 10h" dependendo da relação entre agora e o horário do agendamento.

### Solução

Adicionar uma nova variável `{{quando}}` ao sistema de resolução de templates que calcula automaticamente a expressão temporal correta.

### Lógica de `{{quando}}`

```text
Se agendamento é HOJE       → "hoje às 10:00"
Se agendamento é AMANHÃ     → "amanhã às 10:00"  
Se agendamento é esta semana → "sábado às 10:00"
Se agendamento é > 7 dias   → "dia 05/04 às 10:00"
```

### Arquivos Alterados

**1. `supabase/functions/pipeline-automations/index.ts`**
- Na função `resolveText`, adicionar cálculo de `{{quando}}` usando timezone `America/Sao_Paulo`
- Compara `now` com `data_horario` para determinar: hoje, amanhã, dia da semana, ou data completa
- Também adicionar `{{dia_semana}}` (ex: "sábado") como variável extra

**2. `supabase/functions/agendamentos-cron/index.ts`**
- Na mensagem de retry do lembrete (linha ~197), substituir texto fixo por lógica temporal dinâmica
- Em vez de "sua visita às *10:00*", usar "sua visita *amanhã às 10:00*" ou "sua visita *hoje às 10:00*"

**3. Também no cron**: O cron hoje só move para `lembrete_enviado` agendamentos de **amanhã** (linhas 33-43). Precisa incluir agendamentos de **hoje** que ainda estão em `agendado` (caso de agendamento same-day ou movimentação manual).

### Detalhes Técnicos

Nova função auxiliar em `pipeline-automations`:
```typescript
function resolveQuando(dataHorario: string): string {
  const now = new Date();
  const dt = new Date(dataHorario);
  // Usar timezone SP para comparações de dia
  const nowSP = new Date(now.toLocaleString("en-US", {timeZone: "America/Sao_Paulo"}));
  const dtSP = new Date(dt.toLocaleString("en-US", {timeZone: "America/Sao_Paulo"}));
  const hora = dt.toLocaleTimeString("pt-BR", {hour:"2-digit",minute:"2-digit",timeZone:"America/Sao_Paulo"});
  
  const diffDays = Math.floor((dtSP.setHours(0,0,0,0) - nowSP.setHours(0,0,0,0)) / 86400000);
  
  if (diffDays === 0) return `hoje às ${hora}`;
  if (diffDays === 1) return `amanhã às ${hora}`;
  if (diffDays > 1 && diffDays <= 6) {
    const diaSemana = dt.toLocaleDateString("pt-BR", {weekday:"long", timeZone:"America/Sao_Paulo"});
    return `${diaSemana} às ${hora}`;
  }
  return `dia ${dt.toLocaleDateString("pt-BR", {timeZone:"America/Sao_Paulo"})} às ${hora}`;
}
```

Adicionada ao `resolveText` como `{{quando}}`.

No cron, expandir query de transição para `lembrete_enviado` para incluir agendamentos de hoje que estão em `agendado`:
```text
// Antes: só amanhã
// Depois: hoje OU amanhã (desde que status = agendado)
```

### Resultado
- Mensagem do template: "Oi Natan, lembrando da sua visita **amanhã às 10:00** na Diniz Itapevi"
- Movimentação manual same-day: "...sua visita **hoje às 14:00**..."
- Movimentação manual para sábado: "...sua visita **sábado às 10:00**..."
- Retry do lembrete também usa linguagem temporal correta

