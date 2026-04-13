

# Criação Manual de Cards nos Pipelines

## Problema
Atualmente, cards nos pipelines só são criados automaticamente via bot/WhatsApp. Gestores e diretores não conseguem criar demandas manuais diretamente nos pipelines.

## Solução
Adicionar um botão **"+ Nova Demanda"** em cada pipeline, com um formulário adaptado ao contexto do pipeline. O card criado manualmente entra na primeira coluna do pipeline e dispara as mesmas notificações internas que os cards criados via bot.

## Pipelines Afetados

### 1. Pipeline CRM (`Pipeline.tsx`)
- Botão no header para criar um novo contato já posicionado na primeira coluna
- Formulário: Nome, Telefone, Tipo (cliente/loja/colaborador), Observações
- Ao criar: insere contato + atribui `pipeline_coluna_id` da primeira coluna

### 2. Pipeline Financeiro (`PipelineFinanceiro.tsx`)
- Botão no header para criar solicitação financeira manual
- Formulário: Contato (busca existente ou cria novo), Assunto, Descrição, Tipo, Prioridade
- Ao criar: insere solicitação com `pipeline_coluna_id` da primeira coluna do Financeiro + gera notificação para o setor

### 3. Pipeline Agendamentos (`PipelineAgendamentos.tsx`)
- Botão no header para criar agendamento manual
- Formulário: Contato (busca), Loja, Data/Horário, Observações
- Ao criar: insere agendamento com status "agendado" (primeira coluna)

### 4. Todos os pipelines — Notificação automática
- Após a criação manual, disparar notificação para o setor responsável (inserir na tabela `notificacoes` com `setor_id` correspondente)
- Isso garante que os responsáveis são notificados exatamente como acontece via bot

## Implementação

### Componente reutilizável `CreateCardDialog`
- Dialog com formulário dinâmico baseado no tipo de pipeline
- Props: `pipelineType` ("crm" | "financeiro" | "agendamento"), `setorId`, `firstColumnId`, `onSuccess`

### Arquivos modificados

| Arquivo | Mudança |
|---------|---------|
| `src/components/pipeline/CreateCardDialog.tsx` | **Novo** — componente reutilizável com formulários por tipo |
| `src/pages/Pipeline.tsx` | Adicionar botão "+ Nova Demanda" no header, integrar dialog |
| `src/pages/PipelineFinanceiro.tsx` | Adicionar botão "+ Nova Demanda" no header, integrar dialog |
| `src/pages/PipelineAgendamentos.tsx` | Adicionar botão "+ Nova Demanda" no header, integrar dialog |

### Fluxo pós-criação
1. Inserir o registro (contato/solicitação/agendamento)
2. Atribuir à primeira coluna do pipeline
3. Inserir notificação em `notificacoes` com `setor_id` e título "Nova demanda manual: {assunto}"
4. Invalidar queries para atualizar o Kanban em tempo real
5. Toast de confirmação

