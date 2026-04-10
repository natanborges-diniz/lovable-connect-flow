

# Comunicação Interna via Sistema — Eliminar Dependência de WhatsApp para Setores Passivos

## Visão Geral

Substituir a necessidade de números de WhatsApp para setores internos por uma experiência nativa no sistema web. Os setores passivos (Financeiro, TI, Atendimento Gael) receberão demandas diretamente em seus pipelines setoriais, com notificações in-app e a capacidade de responder/interagir sem sair do sistema.

## Arquitetura Proposta

```text
Loja/Colaborador (WhatsApp)
    │
    ▼
  Bot → Cria Solicitação + Protocolo
    │
    ├── Solicitação aparece no Pipeline do setor destino
    │
    ├── 🔔 Notificação in-app para usuários do setor
    │
    └── Setor responde via interface web
         │
         └── Sistema envia resposta ao solicitante via WhatsApp
```

## Componentes a Implementar

### 1. Sistema de Notificações In-App

**Migração SQL**: tabela `notificacoes`
- `id`, `usuario_id` (profile), `setor_id`, `titulo`, `mensagem`, `tipo` (solicitacao, tarefa, etc.), `referencia_id`, `lida`, `created_at`
- Com Realtime habilitado para push instantâneo

**UI**: ícone de sino no header com badge de contagem, dropdown com lista de notificações, clique leva ao item relevante (solicitação/pipeline)

### 2. Painel de Resposta na Solicitação

Na página de Solicitações (ou no detalhe do card no Pipeline), adicionar uma seção de **comentários/respostas internas**:

**Migração SQL**: tabela `solicitacao_comentarios`
- `id`, `solicitacao_id`, `autor_id` (profile), `autor_nome`, `conteudo`, `tipo` (interno, resposta_cliente), `created_at`

Quando o tipo for `resposta_cliente`, o sistema dispara automaticamente uma mensagem WhatsApp para o solicitante original usando o número da sessão/contato, incluindo o protocolo.

### 3. Gatilho de Notificação na Criação de Solicitação

Modificar `bot-lojas/index.ts` — na `executarAcaoFinal`:
- Em vez de (ou além de) enviar WhatsApp para o responsável, inserir registro em `notificacoes` para todos os usuários do setor destino
- O setor destino é determinado pelo fluxo (cada `bot_fluxos` pode ter um campo `setor_destino_id`)

### 4. Edge Function para Resposta ao Solicitante

Nova edge function `responder-solicitacao`:
- Recebe `solicitacao_id` + `mensagem`
- Busca o contato original e seu último canal/provedor
- Envia mensagem WhatsApp formatada: "📋 Protocolo SOL-2026-XXXXX\n\n{mensagem do setor}"
- Registra como comentário tipo `resposta_cliente`

### 5. Campo `setor_destino_id` nos Fluxos

**Migração SQL**: adicionar coluna `setor_destino_id uuid` na tabela `bot_fluxos` (referência ao setor que recebe a demanda)

Na interface de configuração dos fluxos (`BotFluxosCard.tsx`), adicionar dropdown de setor destino.

## Resultado

- **Setores internos não precisam de número WhatsApp** — recebem tudo no sistema
- **Notificação instantânea** via Realtime quando chega nova solicitação
- **Resposta centralizada** — setor responde pelo sistema, cliente recebe no WhatsApp
- **Rastreabilidade completa** — protocolo + comentários + histórico no mesmo lugar
- **Pipeline setorial** já existe (Financeiro, TI, Gael) — apenas vincula as solicitações

## Arquivos Modificados

| Arquivo | Mudança |
|---------|---------|
| Migração SQL | Tabelas `notificacoes`, `solicitacao_comentarios`; coluna `setor_destino_id` em `bot_fluxos` |
| `supabase/functions/bot-lojas/index.ts` | Criar notificação in-app ao invés de WhatsApp para setores |
| `supabase/functions/responder-solicitacao/index.ts` | Nova function para enviar resposta ao solicitante via WhatsApp |
| `src/components/layout/TopNavigation.tsx` | Ícone de notificações com badge e dropdown |
| `src/pages/Solicitacoes.tsx` | Seção de comentários/respostas no detalhe |
| `src/components/configuracoes/BotFluxosCard.tsx` | Dropdown de setor destino |

