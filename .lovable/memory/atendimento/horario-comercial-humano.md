---
name: Horário Comercial Humano
description: Janela de expediente humano (Seg-Sex 09-18, Sáb 08-12 SP). TODA escalada para humano em ai-triage e watchdogs deve usar mensagemEscaladaForaHorario() fora do expediente.
type: feature
---

## Regra
- **Expediente humano**: Seg-Sex 09:00–18:00, Sáb 08:00–12:00, Domingo fechado (America/Sao_Paulo).
- **Gael (IA)**: atende 24/7. Só a mensagem de escalada muda fora do expediente.
- **Branding**: a mensagem fora do horário sempre informa o próximo expediente (`proximaAberturaHumana()`).

## Helpers (em `ai-triage/index.ts` e `watchdog-loop-ia/index.ts`)
- `getNowInSP()` / `spNow()` — hora atual em SP.
- `isHorarioHumano(): boolean` — true dentro da janela.
- `proximaAberturaHumana(): string` — ex: "amanhã às 09:00".
- `mensagemEscaladaForaHorario(nomePrim: string): string` — mensagem padrão de escalada fora do expediente.

## Pontos de aplicação obrigatórios
TODA escalada que envia mensagem ao cliente DEVE usar o padrão:
```ts
const msg = isHorarioHumano() ? "<msg expediente>" : mensagemEscaladaForaHorario(nomePrim);
```

Aplicado em:
- `ai-triage/index.ts`
  - Loop-detector sem intent claro (~linha 2555)
  - Fechamento LC → consultor (~linha 2447)
  - Fallback determinístico pool exhausted (~linha 682)
  - Escalada genérica fora-de-horário existente (~linha 3616)
- `watchdog-loop-ia/index.ts` — escalada por silêncio/loop (~linha 154)

## Override escalada fora-horário (ai-triage ~linha 8316)
Quando `precisa_humano && !isHorarioHumano()`:
1. Troca a mensagem ao cliente por `mensagemEscaladaForaHorario()`.
2. **Flipa `atendimentos.modo='humano'`** para travar IA até consultor assumir.
3. Calcula `proximaAberturaHumanaDateISO()`; se a próxima abertura está a ≥23h (janela 24h Meta vai estourar), grava `metadata.reabertura_template_at = <ISO>`.
4. `cron-reabertura-fora-horario` (a cada 10min) varre vencidos, confirma janela fechada e dispara `retomada_consultor_v1` (template approved) uma única vez. Idempotente via `metadata.reabertura_template_enviada_at`.

## UX operador (Atendimentos.tsx)
Banner amarelo acima do composer quando última inbound > 23h. Botão "Reabrir via template" abre `JanelaFechadaDialog` (não espera o erro 422 do Enviar).

## Refinamento por marca (anti-falsa-escalada)
Antes de escalar por loop sem intent claro, o detector verifica se o cliente está apenas filtrando o orçamento por marca (ex: "Tem Varilux?" depois de receber DNZ/HOYA). Nesse caso, força `consultar_lentes` com `preferencia_marca` — não escala.

Marcas reconhecidas: varilux/eyezen/crizal/stellest/transitions → ESSILOR; demais (ZEISS, HOYA, KODAK, DNZ, DMAX) usadas literalmente.
