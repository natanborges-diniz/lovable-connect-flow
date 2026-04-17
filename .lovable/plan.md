

User picked Opção B: separar Atendimento Corporativo do CRM, criando novo módulo.

# Plano: Mover Atendimento Corporativo para módulo próprio

## Objetivo
Tirar as 4 colunas (Novo, Em Atendimento, Aguardando, Resolvido) do CRM e criar um módulo dedicado **"Atendimento Interno"** no menu superior, deixando o CRM 100% comercial (vendas).

## Mudanças

### 1. Renomear setor (clareza)
- Migration: `UPDATE setores SET nome='Atendimento Corporativo' WHERE id='32cbd99c-4b20-4c8b-b7b2-901904d0aff6'`
- Gael continua sendo a IA — o setor agora reflete a função real

### 2. Novo módulo "Interno" no menu
- Adicionar em `TopNavigation.tsx` ao lado de TI/Tarefas:
  - Ícone: `Headset` ou `MessagesSquare`
  - Label: **"Interno"**
  - Path: `/interno`
- Adicionar `ModuleKey = "interno"` em `AppLayout.tsx` + `moduleFromPath`
- Adicionar entrada em `AppSidebar` com mesmo padrão dos outros pipelines
- Permissões: visível para admin, operador e usuários com setor = "Atendimento Corporativo"
- Atualizar `SETOR_MODULE_MAP` para mapear setor corporativo → módulo `interno`

### 3. Nova página `PipelineInterno.tsx`
- Clone simplificado de `Pipeline.tsx`, mas filtrando **apenas** colunas com `setor_id = '32cbd99c...'`
- Reusa hooks existentes (`usePipelineColunas`, kanban DnD, `pipeline-automations`)
- Sem aba "Esteira Completa" (essa é específica de vendas → lojas)
- Rota `/interno` no `App.tsx`

### 4. Limpar Pipeline CRM
- Em `Pipeline.tsx`, filtrar colunas para mostrar **apenas `setor_id IS NULL`** (vendas puras)
- Remover qualquer lógica que misturava colunas corporativas
- "Fila Humana" e "Esteira Completa" continuam funcionando normalmente (só com leads de venda)

### 5. Roteamento permanece intacto
- `whatsapp-webhook` e `ai-triage` continuam direcionando contatos `loja`/`departamento` para o setor corporativo — só muda **onde o operador vê**, não a lógica de roteamento
- Renomear constantes `ATENDIMENTO_GAEL_SETOR_ID` → `ATENDIMENTO_CORPORATIVO_SETOR_ID` (mesmo UUID, só clareza)

### 6. Memória
- Atualizar `mem://ia/classificacao-setorial-blindada` com novo nome
- Atualizar `mem://arquitetura/navegacao-setorial-integrada` (agora 9 módulos)
- Nova memória `mem://setor/interno-pipeline-corporativo` documentando o módulo

## Arquivos afetados

| Arquivo | Mudança |
|---------|---------|
| Migration | Renomear setor |
| `src/pages/PipelineInterno.tsx` | **Novo** — pipeline filtrado pelo setor |
| `src/App.tsx` | Nova rota `/interno` |
| `src/components/layout/TopNavigation.tsx` | Novo módulo "Interno" + permissão |
| `src/components/layout/AppLayout.tsx` | `ModuleKey` + `moduleFromPath` |
| `src/components/layout/AppSidebar.tsx` | Seção do novo módulo |
| `src/pages/Pipeline.tsx` | Filtrar `setor_id IS NULL` |
| `supabase/functions/ai-triage/index.ts` | Renomear constante |
| `supabase/functions/whatsapp-webhook/index.ts` | Renomear constante |
| `mem://*` | 3 atualizações |

## O que NÃO muda
- Lógica da IA, roteamento, modos (humano/IA/híbrido), demandas à loja, bot-lojas
- Permissões e RBAC existentes (apenas adicionamos visibilidade do novo módulo)
- Conversas em andamento — ficam no mesmo lugar, só muda o "envelope" visual

