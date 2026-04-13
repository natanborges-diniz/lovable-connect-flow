

# Reestruturação da Navegação — Pipelines Setoriais com Solicitações Integradas

## Diagnóstico

A navegação atual tem 9 abas de topo, com sobreposição funcional:

```text
ATUAL (confuso):
Dashboard | CRM | Financeiro | Agendamentos | Solicitações | Atendimentos | Tarefas | Mensagens | Config
                                               ↑ universal    ↑ WhatsApp
                                               redundante     desconectado
```

Problemas concretos:
- **Solicitações** é uma aba universal que duplica o que cada pipeline setorial já gerencia
- **Atendimentos** (conversas WhatsApp) é uma aba separada do CRM, mas trata de clientes
- **CRM** mistura colunas de Vendas e Atendimento Gael (Interno) num único quadro sem segmentação
- **TI** tem pipeline_colunas no banco (Novo, Impressões, Suporte Técnico, Concluído) mas não tem aba dedicada
- O operador não consegue monitorar onde precisa atuar em cada segmento do CRM

## Nova Estrutura

```text
NOVO (limpo):
Dashboard | CRM | Lojas | Financeiro | TI | Tarefas | Mensagens | Config
             ↓
      Sub-abas dentro do CRM:
      [Pipeline] [Conversas WhatsApp] [Contatos]
      
      Pipeline segmentado por grupo_funil:
      Triagem(2) | Comercial(4) | Pós-Venda | SAC | Terminal
      cada segmento com badge de contagem
```

### Mudanças principais

| De | Para | Motivo |
|----|------|--------|
| Aba "Solicitações" | Removida | Cada pipeline setorial já mostra suas solicitações como cards |
| Aba "Atendimentos" | Sub-aba "Conversas" dentro do CRM | São conversas de clientes, pertencem ao CRM |
| Aba "Agendamentos" | Renomeada para "Lojas" | Alinha com o nome do setor no banco |
| CRM pipeline | Segmentado por `grupo_funil` com tabs e badges | Operador vê claramente onde atuar |
| TI | Nova aba com pipeline próprio | Setor já tem colunas no banco, falta a UI |

### 1. Navegação de topo simplificada (8 itens em vez de 9)
- Remove `solicitacoes` e `atendimentos` do `ModuleKey` e `allModules`
- Renomeia `agendamentos` → `lojas`
- Adiciona `ti` como novo módulo
- Atualiza `SETOR_MODULE_MAP` para refletir as novas chaves
- Atualiza `moduleFromPath` e rotas

### 2. CRM com sub-abas internas
- **Pipeline** (default): segmentado por `grupo_funil` usando Tabs horizontais
  - Cada tab mostra apenas as colunas daquele grupo (Triagem, Comercial, Pós-Venda, SAC, Terminal)
  - Badge com contagem de cards em cada segmento
  - Destaque especial para "Atendimento Humano" com badge vermelho
- **Conversas WhatsApp**: move o conteúdo de `Atendimentos.tsx` para uma sub-aba
- **Contatos**: já existe como `/crm/contatos`

### 3. Pipeline TI (nova página)
- Cria `PipelineTI.tsx` no mesmo padrão de `PipelineFinanceiro.tsx`
- Busca colunas com `setor_id` do setor TI
- Cards são solicitações com `pipeline_coluna_id` nas colunas de TI
- Suporta drag-and-drop e automações

### 4. Sidebar atualizada
- Remove entradas de Solicitações e Atendimentos
- CRM sidebar: Pipeline, Conversas, Contatos
- Lojas sidebar: Pipeline de Agendamentos
- TI sidebar: Pipeline TI

### 5. Rotas atualizadas
```text
/crm              → Pipeline CRM (segmentado)
/crm/conversas    → Conversas WhatsApp (antigo Atendimentos)
/crm/contatos     → Contatos (mantém)
/lojas            → Pipeline Agendamentos (renomeado)
/financeiro       → Pipeline Financeiro (mantém)
/ti               → Pipeline TI (novo)
/tarefas          → Tarefas (mantém)
/mensagens        → Mensagens (mantém)
```

## Arquivos modificados

| Arquivo | Mudança |
|---------|---------|
| `src/components/layout/AppLayout.tsx` | Atualizar `ModuleKey` (remove solicitacoes/atendimentos, add ti, rename agendamentos→lojas) |
| `src/components/layout/TopNavigation.tsx` | Atualizar `allModules`, `SETOR_MODULE_MAP`, `moduleFromPath` |
| `src/components/layout/AppSidebar.tsx` | Atualizar `moduleMenus` com sub-abas do CRM e novos módulos |
| `src/App.tsx` | Atualizar rotas: remove /solicitacoes e /atendimentos, add /crm/conversas, /ti, rename /agendamentos→/lojas |
| `src/pages/Pipeline.tsx` | Adicionar segmentação por `grupo_funil` com Tabs + badges de contagem |
| `src/pages/PipelineTI.tsx` | **Novo** — pipeline para setor TI (mesmo padrão do Financeiro) |
| `src/pages/PipelineAgendamentos.tsx` | Ajustar título para "Pipeline Lojas" |

## Resultado
- Operador do CRM vê segmentos claros (Triagem, Comercial, Pós-venda, SAC) com badges de contagem
- Cada setor interno tem seu próprio pipeline sem interferência
- Solicitações não são mais uma aba separada — vivem dentro do pipeline do setor que as criou
- Conversas WhatsApp ficam dentro do CRM, onde fazem sentido
- Navegação reduzida de 9 para 8 itens, cada um com propósito claro

