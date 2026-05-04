---
name: Horários de Funcionamento das Lojas
description: Tabela canônica de horários por loja e regra de feriados nacionais (shoppings vs rua)
type: feature
---

## Lojas de rua (seg-sex 09–18, sáb 09–17, dom fechado)
- DINIZ ANTONIO AGU
- DINIZ BARUERI
- DINIZ CARAPICUIBA
- DINIZ ITAPEVI
- DINIZ PRIMITIVA I
- DINIZ PRIMITIVA II
- DINIZ STO ANTONIO

Feriados nacionais: **fechadas** (`loja_feriado_politica.default_nacional = fechada`).

## Lojas de shopping (seg-sáb 10–22, dom 14–20)
- DINIZ SUPER SHOPPING
- DINIZ UNIÃO

Feriados nacionais: **abrem com horário de domingo (14–20)** via `default_nacional = abre_horario_domingo`.
Exceções (fechadas): **01/01 (Confraternização)** e **01/05 (Dia do Trabalho)** — controlado por `feriados.fecha_todas = true`, que sobrepõe a política da loja.

## Engine
Função `loja_status_no_dia(loja_id, data)` resolve abertura/horário considerando feriado, política da loja e horário semanal. `agendar-cliente` chama essa função e bloqueia agendamentos fora do intervalo.
