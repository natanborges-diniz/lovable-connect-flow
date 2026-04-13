

# Movimentação Manual entre Pipelines com Campos Obrigatórios

## Problema Identificado

1. **Seletor de coluna no card só mostra CRM** — `usePipelineColunas()` sem argumento filtra `setor_id IS NULL`, excluindo Lojas, Financeiro e TI
2. **Mover para "Lojas" exige dados que não existem** — o pipeline Lojas opera sobre a tabela `agendamentos` (que precisa de `loja_nome`, `data_horario`), não sobre `contatos.pipeline_coluna_id`
3. **Nenhuma etapa solicita campos obrigatórios** — ao mover manualmente para qualquer coluna, não há validação dos dados necessários

## Solução

### 1. Seletor multi-pipeline no card

Buscar TODAS as colunas de TODOS os setores, agrupadas por setor:

```text
── CRM ──
  Triagem > Novo, Retorno
  Comercial > Lead, Qualificado, Orçamento
  ...
── Lojas ──
  Agendado, Confirmado, Atendido, ...
── Financeiro ──
  Novo, Link Enviado, ...
── TI ──
  Novo, Impressões, ...
```

Nova query: `usePipelineColunasAll()` que busca todas as colunas ativas com join em `setores.nome`.

### 2. Formulário condicional por destino (campos obrigatórios)

Quando o operador seleciona uma coluna de **outro pipeline**, um mini-formulário aparece pedindo os campos necessários:

| Pipeline destino | Campos obrigatórios |
|-----------------|---------------------|
| **Lojas** (qualquer coluna) | Loja (select de `telefones_lojas`), Data/Hora, Observações (opcional) |
| **Financeiro** (qualquer coluna) | Assunto, Tipo (select), Descrição (opcional) |
| **TI** (qualquer coluna) | Assunto, Tipo, Descrição |
| **CRM** (outra coluna CRM) | Nenhum campo extra — move direto |

### 3. Lógica de transição por pipeline

**CRM → Lojas:**
1. Mostrar formulário com select de loja + datetime picker
2. Ao confirmar, invocar `agendar-cliente` (cria registro em `agendamentos`)
3. Limpar `contatos.pipeline_coluna_id` (sai do CRM Kanban)
4. Card aparece no pipeline Lojas como agendamento

**CRM → Financeiro:**
1. Mostrar formulário com assunto + tipo
2. Criar `solicitacao` com `pipeline_coluna_id` da coluna financeira selecionada
3. Manter ou limpar `contatos.pipeline_coluna_id` conforme o caso

**CRM → TI:**
1. Mostrar formulário com assunto + descrição
2. Criar `solicitacao` com `pipeline_coluna_id` da coluna TI selecionada

**Dentro do mesmo pipeline:**
1. Mover direto sem formulário extra

### 4. Drag-and-drop também valida

O drag-and-drop hoje só opera dentro do CRM. Manter assim — movimentação entre pipelines é feita exclusivamente pelo seletor no card detail, onde o formulário pode ser apresentado.

## Arquivos

| Arquivo | Mudança |
|---------|---------|
| `src/hooks/usePipelineColunas.ts` | Adicionar `usePipelineColunasAll()` que busca todas colunas com setor |
| `src/pages/Pipeline.tsx` | No `ConversationPanel`: usar `usePipelineColunasAll()`, agrupar por setor, exibir formulário condicional ao selecionar coluna de outro pipeline |
| `src/components/pipeline/TransferPipelineDialog.tsx` | **Novo** — dialog com formulário condicional (loja+data para Lojas, assunto+tipo para Financeiro/TI) |

## Fluxo do operador

```text
1. Abre card no CRM
2. Clica no seletor "Etapa"
3. Vê todas colunas de todos pipelines agrupadas por setor
4. Seleciona "Lojas > Agendado"
5. Mini-formulário aparece: [Loja ▼] [Data/Hora] [Observações]
6. Preenche e confirma
7. Sistema cria agendamento via agendar-cliente
8. Card sai do CRM, aparece no pipeline Lojas
9. Toast: "Agendamento criado — contato transferido para Lojas"
```

