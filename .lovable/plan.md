

## Plano de Contingência — Fluxo Pós-Lembrete

### Cenários cobertos

```text
                    Lembrete Enviado (24h antes)
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
         Confirmou    Não respondeu   Cancelou
         (→ Confirmado)  (ver abaixo)  (→ Cancelado)
```

### 1. Cliente NÃO confirma o lembrete

**Regra**: Se o cliente não responde ao lembrete em **4 horas** (ou até 2h antes do horário agendado, o que vier primeiro), o sistema envia uma **segunda tentativa** — uma mensagem curta tipo:

> "Oi {{primeiro_nome}}, ainda não conseguimos confirmar sua visita amanhã às {{hora}} na {{loja}}. Podemos manter? Responda SIM ou se preferir reagendar, é só dizer 😊"

Se após essa segunda tentativa ele ainda não responder até **1h antes do horário**, o agendamento permanece como está (não cancela automaticamente — o cliente pode simplesmente aparecer). O card fica em **"Lembrete Enviado"** e o fluxo segue normalmente para a cobrança à loja após o horário.

**Nova coluna sugerida**: Não precisa. O status "Lembrete Enviado" já cobre isso. Apenas adicionamos um campo `tentativas_lembrete` no agendamento.

### 2. Cobrança à loja — quem dá o gatilho de presença

**Fluxo atual (correto)**:
- Horário do agendamento passa → Cron marca `confirmacao_enviada` → Envia mensagem à loja via Bot perguntando se o cliente compareceu
- Loja responde via **Opção 4 do Bot** → Sistema atualiza `loja_confirmou_presenca`
  - `true` → Card move para **Atendido**
  - `false` → Card move para **No-Show** → Dispara recuperação

### 3. Contingência: loja NÃO responde

```text
Horário passou
    │
    ▼
Cobrança 1 à loja (imediata ou 09h dia seguinte se fora do expediente)
    │
    ├── Loja responde → fluxo normal
    │
    ▼ (sem resposta em 3h)
Cobrança 2 à loja (nudge mais direto)
    │
    ├── Loja responde → fluxo normal
    │
    ▼ (sem resposta em 6h após cobrança 2)
Sistema assume NO-SHOW + cria TAREFA para operador
    → Card move para "No-Show"
    → Tarefa: "Loja {{loja}} não respondeu sobre {{cliente}} - verificar manualmente"
    → Recuperação com cliente é disparada normalmente
```

**Campos novos em `agendamentos`**:
- `tentativas_lembrete` (integer, default 0) — controla quantas vezes o lembrete foi enviado ao cliente
- `tentativas_cobranca_loja` (integer, default 0) — controla quantas vezes a loja foi cobrada

### 4. Ajustes no Cron (`agendamentos-cron`)

O cron ganha duas novas verificações:

- **Reenvio de lembrete ao cliente**: Se `status = 'lembrete_enviado'` e `tentativas_lembrete = 1` e passaram 4h sem resposta inbound → envia segunda tentativa, seta `tentativas_lembrete = 2`
- **Segunda cobrança à loja**: Se `confirmacao_enviada = true` e `tentativas_cobranca_loja = 1` e passaram 3h sem resposta → envia segunda cobrança, seta `tentativas_cobranca_loja = 2`
- **Timeout da loja**: Se `tentativas_cobranca_loja >= 2` e passaram 6h+ → move para `no_show` + cria tarefa manual

### 5. Automações por coluna (resumo)

| Coluna | Gatilho | Ação |
|---|---|---|
| Agendado | IA confirma no chat | Mensagem livre de confirmação |
| Lembrete Enviado | Cron 24h antes | Template `lembrete_agendamento` |
| Confirmado | Cliente responde ao lembrete | Nenhuma automação extra |
| Atendido | Loja confirma via Bot | Template pós-atendimento (opcional) |
| No-Show | Loja nega OU timeout de cobrança | Mensagem de recuperação ao cliente |
| Recuperação | Cliente responde após no-show | IA conduz conversa |
| Abandonado | 48h sem resposta após 2 tentativas | Nenhuma |

### Implementação

1. **Migration**: adicionar `tentativas_lembrete` e `tentativas_cobranca_loja` à tabela `agendamentos`
2. **Cron**: adicionar lógica de reenvio de lembrete e segunda cobrança à loja com timeout
3. **Pipeline-automations**: garantir que o move para `no_show` por timeout da loja também crie tarefa automática
4. **UI**: atualizar cards do pipeline para mostrar indicadores de tentativas

