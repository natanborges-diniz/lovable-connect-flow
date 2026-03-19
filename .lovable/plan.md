

## Arquitetura Refinada — Sistema de Comunicação e Operação v2

---

### 1. Entidades Principais (atualizado)

| Entidade | Papel |
|---|---|
| **Contato** | Registro CRM central. Cliente, fornecedor, loja, colaborador. Suporta atributos dinâmicos e múltiplos canais. |
| **Canal** | Meio de comunicação do contato (WhatsApp, Sistema, E-mail). Vinculado ao contato. |
| **Setor** | Unidade organizacional (Financeiro, Logística, Comercial, etc.). Define filas, SLAs, permissões e responsabilidades. |
| **Solicitação** | Entrada leve com ciclo de vida próprio. Ponte entre Atendimento e Tarefa. Nunca é "filha" de nenhuma das duas. |
| **Atendimento** | Sessão de comunicação. Contém Mensagens. Vinculado a Solicitação e Fila de Atendimento. |
| **Mensagem** | Unidade atômica de comunicação dentro de um Atendimento. Tem direção (entrada/saída), tipo (texto, mídia, template), remetente, timestamp. |
| **Tarefa** | Unidade de execução operacional. Vinculada a Solicitação e Fila de Execução. Tem responsável, setor, prazo, checklist. |
| **Fila de Atendimento** | Distribui solicitações/atendimentos para agentes de comunicação. Pertence a um Setor. |
| **Fila de Execução** | Distribui tarefas para executores operacionais. Pertence a um Setor. |
| **Agente/Usuário** | Operador do sistema. Vinculado a setores, filas e perfil de permissão. |
| **SLA** | Regra de tempo por setor + tipo de solicitação/tarefa. Aplicado separadamente a atendimento e execução. |

---

### 2. Relações entre Entidades

```text
Contato (1) ──── (N) Canal
Contato (1) ──── (N) Solicitação
Contato (1) ──── (N) Atributo Dinâmico (via metadata/tags)
Contato (1) ──── (N) Evento CRM

Solicitação (1) ──── (0..N) Atendimento
Solicitação (1) ──── (0..N) Tarefa
  ↑ ponte — Atendimento e Tarefa NUNCA se referenciam diretamente

Atendimento (1) ──── (N) Mensagem
Atendimento (N) ──── (1) Agente
Atendimento (N) ──── (1) Fila de Atendimento

Tarefa (N) ──── (1) Agente/Responsável
Tarefa (N) ──── (1) Fila de Execução
Tarefa (N) ──── (1) Setor

Setor (1) ──── (N) Fila de Atendimento
Setor (1) ──── (N) Fila de Execução
Setor (1) ──── (N) SLA
Setor (1) ──── (N) Agente (via vínculo)
```

---

### 3. Entidade Setor — Detalhamento

| Aspecto | Descrição |
|---|---|
| **Filas** | Cada setor possui suas próprias filas de atendimento e filas de execução |
| **SLA** | Regras de prazo por tipo de solicitação e prioridade, configuráveis por setor |
| **Permissões** | Agentes só veem/atuam nas filas dos setores aos quais pertencem |
| **Tarefas** | Toda tarefa pertence a um setor; setor define os executores possíveis |
| **Escalação** | SLA vencido dispara alerta ao gestor do setor |

---

### 4. Filas: Atendimento vs Execução

| | Fila de Atendimento | Fila de Execução |
|---|---|---|
| **Contém** | Solicitações aguardando comunicação | Tarefas aguardando execução |
| **Operador** | Atendente / agente de comunicação | Executor / técnico / setor operacional |
| **SLA** | Tempo de primeira resposta, tempo de resolução comunicacional | Prazo de conclusão da tarefa |
| **Encerramento** | Atendimento encerrado ≠ tarefa encerrada | Tarefa concluída ≠ atendimento reaberto |
| **Pertence a** | Setor | Setor |

---

### 5. Ciclo de Vida da Solicitação

```text
[aberta] → [classificada] → [em_atendimento] → [aguardando_execução] → [concluída]
                                    ↓                      ↓
                              [cancelada]            [reaberta] → [em_atendimento]
```

| Status | Significado |
|---|---|
| **aberta** | Criada, aguardando classificação (automática ou manual) |
| **classificada** | Tipo, assunto e prioridade definidos; roteada para fila |
| **em_atendimento** | Atendimento ativo vinculado |
| **aguardando_execução** | Atendimento pode estar encerrado; tarefa(s) em andamento |
| **concluída** | Todas as tarefas finalizadas e/ou demanda resolvida |
| **cancelada** | Encerrada sem resolução (duplicada, inválida, desistência) |
| **reaberta** | Retorno do solicitante ou nova necessidade sobre mesma demanda |

**Transições automáticas permitidas:**
- `aberta → classificada`: IA classifica com confiança acima do threshold
- `classificada → em_atendimento`: agente assume na fila
- `em_atendimento → aguardando_execução`: tarefa criada (automática ou manual)
- `aguardando_execução → concluída`: todas as tarefas com status "done"

---

### 6. Criação Automática de Tarefa

Regras configuráveis por `(tipo_contato + assunto + canal)`:

| Condição | Ação |
|---|---|
| Assunto = "Troca/Devolução" | Criar tarefa automaticamente no setor Logística |
| Assunto = "Nota Fiscal" | Criar tarefa automaticamente no setor Financeiro |
| Assunto = "Dúvida geral" | Não criar tarefa; resolver no atendimento |
| Flag `auto_task = true` na regra de roteamento | Solicitação gera tarefa ao ser classificada |

A tarefa automática nasce com status `pendente` e entra na fila de execução do setor. Agente de atendimento é notificado mas não precisa criá-la manualmente.

---

### 7. Papel das Lojas no Sistema

| Ação | Como |
|---|---|
| **Criar solicitação** | Interface simplificada (formulário guiado por tipo) ou WhatsApp |
| **Acompanhar solicitações** | Painel "Minhas Solicitações" com status em tempo real |
| **Visualizar tarefas destinadas** | Quando a loja é destinatária/executora de uma tarefa (ex: "preparar produto para coleta") |
| **Atuar em tarefas** | Marcar etapas do checklist, atualizar status, anexar evidências |
| **Limitações** | Não vê filas internas, não redireciona, não acessa CRM |

Perfil "Loja" = visão filtrada do sistema, restrita às próprias solicitações e tarefas atribuídas.

---

### 8. Core CRM Expandido

| Capacidade | Descrição |
|---|---|
| **Atributos dinâmicos** | Campos customizáveis por tipo de contato (JSON/metadata). Ex: "CNPJ" para fornecedor, "região" para loja |
| **Tags e segmentação** | Tags livres + segmentos configuráveis para campanhas e filtros |
| **Eventos** | Registro cronológico de interações: solicitação criada, atendimento encerrado, tarefa concluída, nota adicionada |
| **Histórico unificado** | Timeline com todas as solicitações, atendimentos e tarefas do contato |
| **Gatilhos (futuro)** | Regras do tipo "quando contato receber tag X, criar solicitação tipo Y". Estrutura pronta, ativação por fase |
| **Integrações (futuro)** | Modelo extensível para ERP, e-commerce, sistemas de NF. Contato como chave de vínculo |

---

### 9. Entidade Mensagem — Detalhamento

| Campo | Descrição |
|---|---|
| **atendimento_id** | Vinculada ao atendimento |
| **direção** | `inbound` (recebida) / `outbound` (enviada) |
| **tipo** | `texto`, `imagem`, `documento`, `áudio`, `template`, `nota_interna` |
| **remetente** | Contato (externo) ou Agente (interno) |
| **canal_origem** | WhatsApp, Sistema, etc. |
| **timestamp** | Data/hora exata |
| **metadata** | ID externo WhatsApp, status de entrega, dados de mídia |

`nota_interna` = mensagem visível apenas para agentes, não enviada ao contato.

---

### 10. Fluxos Atualizados

**A) Cliente via WhatsApp**
1. Mensagem → Mensagem `inbound` registrada → Solicitação `aberta` criada
2. IA classifica → Solicitação passa a `classificada`
3. Roteamento → Fila de Atendimento do setor
4. Agente assume → Atendimento aberto → Solicitação `em_atendimento`
5. Se regra `auto_task` ativa: Tarefa criada automaticamente → Fila de Execução
6. Se não: agente decide criar tarefa manualmente ou resolver no atendimento
7. Respostas do agente = Mensagens `outbound` enviadas via WhatsApp

**B) Loja via Sistema**
1. Loja preenche formulário guiado → Solicitação `classificada` (já estruturada)
2. Roteamento → Fila de Atendimento ou direto para Fila de Execução (se auto_task)
3. Loja acompanha pelo painel "Minhas Solicitações"
4. Se tarefa atribuída à loja → aparece no painel "Minhas Tarefas"

**C) Loja via WhatsApp**
1. Mesmo fluxo do cliente, mas contato identificado como tipo "loja"
2. Roteamento prioriza fila "Suporte Lojas"
3. Sistema pode sugerir ao atendente que oriente a loja para usar o sistema interno

**D) Tarefa Interna (sem origem externa)**
1. Agente/gestor cria Solicitação interna com tipo "demanda interna"
2. Solicitação nasce `classificada` → Tarefa criada imediatamente
3. Tarefa entra na Fila de Execução do setor responsável
4. Solicitação acompanha ciclo normalmente

---

### 11. Roteamento Automático (atualizado)

```text
Entrada → Identificar Contato → Classificar (IA/regra)
  ↓
Matriz de roteamento:
  (tipo_contato + canal + assunto + prioridade)
  ↓
  → Fila de Atendimento (se requer comunicação)
  → Fila de Execução   (se auto_task = true, direto para tarefa)
  → Ambas              (se requer comunicação + execução paralela)
  ↓
Fallback: Fila "Triagem Geral" do setor Operações
```

---

### 12. IA — Governança mantida

| Ação da IA | Tipo | Autonomia |
|---|---|---|
| Classificar assunto/prioridade | Sugestão | Aceita automática se confiança > threshold; senão, revisão humana |
| Sugerir fila de destino | Sugestão | Aplicada automaticamente via regra; agente pode redirecionar |
| Sugerir resposta ao atendente | Sugestão | Nunca enviada sem aprovação |
| Resumir histórico do contato | Automático | Sem risco — somente leitura |
| Criar tarefa | Regra configurada | IA não decide; regra de roteamento define |

---

### Resumo dos Módulos para BUILD

| Módulo | Entidades | Fase sugerida |
|---|---|---|
| **Core CRM** | Contato, Canal, Atributo Dinâmico, Evento, Tag | Fase 1 |
| **Core Solicitações** | Solicitação (com ciclo de vida completo) | Fase 1 |
| **Core Atendimento** | Atendimento, Mensagem | Fase 2 |
| **Core Tarefas** | Tarefa, Checklist, SLA de execução | Fase 2 |
| **Core Filas e Roteamento** | Fila de Atendimento, Fila de Execução, Regras de Roteamento, Setor | Fase 2 |
| **Integração WhatsApp** | Webhook entrada, envio de mensagens, templates | Fase 3 |
| **Motor IA** | Classificação, sugestões, resumos | Fase 3 |
| **Portal Loja** | Visão filtrada: minhas solicitações, minhas tarefas | Fase 3 |

