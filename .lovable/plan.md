# Feriados no calendário e horários especiais por loja

## Diagnóstico atual

Hoje, em `telefones_lojas`, cada loja tem **apenas um par** `horario_abertura` / `horario_fechamento` (texto `HH:MM`). Não há:
- distinção por dia da semana (seg–sex / sáb / dom),
- conceito de feriado,
- regra de exceção por loja.

A IA (`ai-triage`) e a UI de Configurações (`TelefonesLojasCard`) leem somente esse par único, então qualquer feriado é "invisível" para o sistema.

Regra de negócio confirmada:
- **Domingo** — só **Shopping União** e **Super Shopping** abrem, das **14:00 às 20:00**.
- **Feriados nacionais** — só Shopping União e Super Shopping abrem, **usando o mesmo horário de domingo (14:00–20:00)**.
- **Exceções absolutas** — **01/01** e **01/05**: todas as lojas fechadas, inclusive os shoppings.

## Proposta — visão geral

Três camadas, encaixadas no que já existe:

1. **Horários por dia da semana** em cada loja (estende `telefones_lojas`).
2. **Calendário de feriados** central (nova tabela `feriados`), com tipo e flag "fecha tudo".
3. **Política de feriado por loja** (nova tabela `loja_feriado_politica`) para dizer, por loja, o que acontece num feriado nacional: `fechada` (default) ou `abre_horario_domingo`.

Tudo é consultado por uma função `loja_status_no_dia(loja, data) → { aberta, abre, fecha, motivo }`, que vira o ponto único usado pela IA, pelo cron de agendamentos e pela UI.

---

## 1. Modelo de dados

### 1.1 `telefones_lojas` — horários por dia da semana

Adicionar coluna `horarios_semana jsonb`. Mantemos `horario_abertura`/`horario_fechamento` por compatibilidade (preenchidos a partir de seg–sex), mas o JSON passa a ser a fonte da verdade.

Formato:
```json
{
  "seg": { "abre": "09:00", "fecha": "19:00" },
  "ter": { "abre": "09:00", "fecha": "19:00" },
  "qua": { "abre": "09:00", "fecha": "19:00" },
  "qui": { "abre": "09:00", "fecha": "19:00" },
  "sex": { "abre": "09:00", "fecha": "19:00" },
  "sab": { "abre": "09:00", "fecha": "18:00" },
  "dom": null
}
```
- `null` = fechada nesse dia.
- Shopping União e Super Shopping iniciam com `dom = { "abre": "14:00", "fecha": "20:00" }`.
- Demais lojas: `dom = null`.

### 1.2 Nova tabela `feriados`

```text
feriados
- id uuid pk
- data date
- nome text
- tipo text            -- 'nacional' | 'estadual' | 'municipal' | 'interno'
- fecha_todas boolean  -- true para 01/01 e 01/05
- recorrente boolean   -- true = repete todo ano na mesma data
- ativo boolean
- metadata jsonb
- unique (data, nome)
```

Seeds iniciais (nacionais, recorrentes salvo móveis):
- 01/01 Confraternização — `fecha_todas = true`
- 01/05 Dia do Trabalho — `fecha_todas = true`
- 21/04 Tiradentes
- 07/09 Independência
- 12/10 Padroeira
- 02/11 Finados
- 15/11 República
- 20/11 Consciência Negra
- 25/12 Natal
- Sexta-feira Santa, Carnaval (terça) e Corpus Christi como linhas anuais não-recorrentes.

### 1.3 Nova tabela `loja_feriado_politica`

```text
loja_feriado_politica
- id uuid pk
- loja_id uuid (fk telefones_lojas)
- escopo text          -- 'default_nacional' | 'feriado_especifico'
- feriado_id uuid null
- politica text        -- 'fechada' | 'abre_horario_domingo' | 'abre_horario_normal' | 'abre_horario_customizado'
- horario_custom jsonb null
- ativo boolean
- unique (loja_id, escopo, feriado_id)
```

Seeds iniciais:
- Todas as lojas → `escopo='default_nacional'`, `politica='fechada'`.
- Shopping União e Super Shopping → `escopo='default_nacional'`, `politica='abre_horario_domingo'`.
- 01/01 e 01/05 não precisam de override: `feriados.fecha_todas=true` vence qualquer política.

### 1.4 Função `loja_status_no_dia`

`loja_status_no_dia(_loja_id uuid, _data date) returns jsonb`, retornando ex.:
```json
{ "aberta": true, "abre": "14:00", "fecha": "20:00", "motivo": "feriado_horario_domingo" }
```
Regras (ordem):
1. Feriado ativo na data com `fecha_todas=true` → fechada (motivo `feriado_nacional_total`).
2. Feriado ativo + `loja_feriado_politica` aplicável:
   - `fechada` → fechada,
   - `abre_horario_domingo` → usa `horarios_semana.dom` (se `null`, fechada),
   - `abre_horario_normal` → usa horário do dia da semana real,
   - `abre_horario_customizado` → usa `horario_custom`.
3. Sem feriado → usa `horarios_semana[dia_da_semana]` (`null` = fechada, motivo `dia_fechado`).

---

## 2. UI — Configurações

### 2.1 Card "Telefones / Lojas" (existente)

No diálogo de edição da loja, substituir os dois inputs únicos por uma **grade de 7 linhas (seg…dom)** com `abre`, `fecha` e toggle "fechado". `horario_abertura`/`horario_fechamento` legados são preenchidos a partir de seg→sex automaticamente.

Badge "Aberta hoje 14:00–20:00 (feriado)" no card, calculado via `loja_status_no_dia` para o dia atual.

### 2.2 Novo card "Feriados" em `Configurações`

Dois blocos:

**(a) Calendário de feriados** — tabela com `data | nome | tipo | fecha todas? | ativo`. Botões "Adicionar feriado" e "Importar feriados nacionais do ano X" (gera as datas recorrentes + móveis com cálculo de Páscoa).

**(b) Política por loja** — para cada loja ativa, seletor de política padrão em feriados nacionais:
- Fechada (default)
- Abre no horário de domingo
- Abre no horário normal do dia
- Customizado

Pré-seleciona Shopping União e Super Shopping em "Abre no horário de domingo".

Cada feriado da lista tem botão "Overrides" para setar exceções pontuais por loja.

---

## 3. Integrações que passam a usar a função

- **`ai-triage`**: ao montar a string de horários no prompt, passa a usar `loja_status_no_dia` para o(s) dia(s) relevantes. Lojas fechadas no dia não aparecem na lista oferecida ao cliente. Em 01/01 e 01/05, instrução automática "todas as lojas fechadas, ofereça outra data".
- **`agendar-cliente`**: antes de criar o `agendamento`, valida se a loja está aberta na `data_horario`; se não, retorna erro estruturado para a IA reformular.
- **`agendamentos-cron` / lembretes**: ao montar mensagens de confirmação, checa se a loja realmente abre no dia — caso contrário, gera evento `agendamento_em_dia_fechado` para revisão humana.
- **Bot de lojas**: respostas tipo "estamos abertos hoje?" passam pela mesma função.

---

## 4. Migrações e seeds

1. Schema: adiciona `horarios_semana jsonb` em `telefones_lojas`; cria `feriados`, `loja_feriado_politica` e a função `loja_status_no_dia`.
2. Backfill de `horarios_semana`: para cada loja, popula seg–sex a partir do `horario_abertura/fechamento` atual; sáb = `09:00–18:00` (default revisável); dom = `null`.
3. Override Shopping União + Super Shopping: `dom = { "abre": "14:00", "fecha": "20:00" }`.
4. Seed `feriados` para o ano corrente e o próximo.
5. Seed `loja_feriado_politica`:
   - todas as lojas → `default_nacional = fechada`,
   - Shopping União + Super Shopping → `default_nacional = abre_horario_domingo`.
6. Marcar 01/01 e 01/05 com `fecha_todas=true`.

---

## 5. Pontos a confirmar antes de implementar

1. **Sábado das lojas de rua** — manter `09:00–18:00` no backfill? (Memória registra `Seg-Sex 09–18 / Sáb 08–12` para humano, mas isso parece ser o horário do atendimento humano interno, não da loja física. Confirmar.)
2. **Feriados estaduais (SP) e municipais (Osasco etc.)** — entram no calendário também? Sugestão: cadastrados, mas com política padrão "abre_horario_normal" salvo configuração contrária.
3. **Outras lojas que abrem em algum feriado pontual** (ex.: véspera de Natal, Black Friday)? Se sim, ficam como overrides por feriado; se não, regra geral basta.

Posso seguir com defaults sensatos pras 3 perguntas (ajustáveis depois pela UI), ou prefere responder antes da implementação.
