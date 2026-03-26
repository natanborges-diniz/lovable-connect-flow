

## Plano: Unificar Atendimentos Cross-Canal + Auto-Confirmar Agendamento

### Problemas

1. **`send-whatsapp-template` cria SEMPRE um novo atendimento** (solicitação + atendimento com `canal_provedor: meta_official`). Quando o cliente responde "sim" ao lembrete, o webhook encontra esse atendimento novo em vez do original — gerando dois atendimentos separados para o mesmo cliente.

2. **Nenhuma lógica detecta "sim" como confirmação** de agendamento. O cliente responde "sim" ao lembrete mas o card fica parado em `lembrete_enviado`.

### Solução

#### 1. `send-whatsapp-template` — Reutilizar atendimento existente

Em vez de criar solicitação + atendimento novos, buscar atendimento aberto do contato (qualquer provedor). Se existir, registrar a mensagem do template nesse atendimento existente. Se não existir, aí sim criar um novo.

```text
Antes:  SEMPRE cria solicitação + atendimento
Depois: Busca atendimento aberto → se existe, usa ele → se não, cria novo
```

A mensagem do template é salva com `provedor: "meta_official"` para rastreabilidade, mas dentro do mesmo atendimento.

#### 2. `whatsapp-webhook` — Buscar atendimento sem filtrar por provedor

Alterar a busca de atendimento aberto para NÃO filtrar por `canal_provedor`. Assim, quando o cliente responde via meta_official a um template, o webhook encontra o atendimento original (que pode ser evolution_api).

Atualizar o `canal_provedor` do atendimento para o canal mais recente (para que respostas saiam pelo canal correto).

```text
Antes:  .eq("canal_provedor", source)
Depois: sem filtro de provedor → encontra qualquer atendimento aberto do contato
        → atualiza canal_provedor para o source atual
```

#### 3. `whatsapp-webhook` — Detecção de confirmação pré-IA

Antes de acionar a IA, verificar se o cliente tem agendamento em `lembrete_enviado` e a mensagem é uma confirmação (sim, confirmo, ok, etc.). Se sim:
- Atualizar agendamento para `confirmado`
- Disparar `pipeline-automations` para o novo status
- Registrar evento CRM
- Enviar resposta determinística ("Confirmado! Te esperamos...")
- NÃO acionar a IA (resposta já tratada)

```text
Palavras-chave de confirmação:
"sim", "confirmo", "confirmado", "ok", "vou sim", "pode confirmar", 
"estarei lá", "vou estar", "combinado", "fechado", "tá bom", "beleza"
```

### Arquivos Alterados

**1. `supabase/functions/send-whatsapp-template/index.ts`**
- Remover criação automática de solicitação + atendimento
- Buscar atendimento aberto do contato (sem filtro de provedor)
- Se existir, salvar mensagem nele; se não, criar novo

**2. `supabase/functions/whatsapp-webhook/index.ts`**
- Linha 100-110: Remover `.eq("canal_provedor", source)` da busca de atendimento
- Após encontrar atendimento, atualizar `canal_provedor` para o source atual
- Adicionar bloco de detecção de confirmação entre etapas 5 (salvar mensagem) e 7 (check homologação)

**3. `supabase/functions/pipeline-automations/index.ts`**
- Sem alterações — já suporta status `confirmado`

### Resultado

- Cliente tem UM único atendimento, independente do canal de saída (template oficial vs evolution)
- Operador vê todo o histórico unificado na mesma conversa
- "Sim" ao lembrete → card move automaticamente para "Confirmado"
- Automações de `confirmado` disparam corretamente

