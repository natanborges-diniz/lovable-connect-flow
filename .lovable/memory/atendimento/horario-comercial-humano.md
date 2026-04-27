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

## Refinamento por marca (anti-falsa-escalada)
Antes de escalar por loop sem intent claro, o detector verifica se o cliente está apenas filtrando o orçamento por marca (ex: "Tem Varilux?" depois de receber DNZ/HOYA). Nesse caso, força `consultar_lentes` com `preferencia_marca` — não escala.

Marcas reconhecidas: varilux/eyezen/crizal/stellest/transitions → ESSILOR; demais (ZEISS, HOYA, KODAK, DNZ, DMAX) usadas literalmente.
