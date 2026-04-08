

# Incrementar Chatbot Corporativo — Fluxos Internos com Responsável e Notificação

## Contexto

O diagrama define ~10 novos fluxos internos (Estorno PIX, Cancelamento Cartão, Reembolso, etc.). O motor genérico (`bot-lojas`) já suporta novos fluxos via dados no banco. O ponto principal desta revisão: **cada fluxo precisa de um responsável configurável que será notificado via WhatsApp quando a tarefa for criada**, e esse responsável acompanha a tarefa no pipeline do setor correspondente.

## Arquitetura: Responsável por Fluxo

### Nova tabela: `fluxo_responsaveis`

Cadastro de responsáveis por fluxo, com telefone para acionamento:

| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | uuid | PK |
| fluxo_chave | text | Chave do fluxo (ex: `estorno_pix`) |
| nome | text | Nome do responsável |
| telefone | text | WhatsApp do responsável |
| tipo | text | `primario` ou `contingencia` |
| ativo | boolean | Se está ativo |

Isso permite:
- **Primário**: recebe a notificação sempre que o fluxo gera uma solicitação
- **Contingência**: acionado se o primário não responder em X minutos (fase futura), ou em fluxos que exigem aprovação (ex: Reembolso → Natan autoriza)

### UI de Cadastro (Configurações)

Dentro da tela de Configurações, na seção de Fluxos do Bot, ao editar um fluxo, haverá uma aba/seção **"Responsáveis"** onde o operador configura:
- Nome do responsável
- Telefone (WhatsApp)
- Tipo: Primário / Contingência
- Ativo/Inativo

### Notificação automática ao responsável

No `executarAcaoFinal` do `bot-lojas`, após criar a solicitação, o sistema:
1. Consulta `fluxo_responsaveis` para o fluxo executado
2. Envia WhatsApp ao responsável primário com resumo da solicitação (loja solicitante, dados coletados, link/referência)
3. Se houver contingência configurada, registra para follow-up

### Pipeline e acompanhamento

As solicitações criadas pelos fluxos já vão para o pipeline do setor (Financeiro, TI, etc.) com a coluna correta. O responsável:
- Recebe notificação no WhatsApp
- Acompanha o card no pipeline correspondente
- Move o card conforme executa a tarefa

## Os 10 Novos Fluxos (com responsável e contingência)

| # | Fluxo | Responsável Padrão | Contingência |
|---|-------|--------------------|--------------|
| 1 | Confirmação de PIX | Financeiro | -- |
| 2 | Estorno PIX/Débito/Dinheiro | Financeiro | Natan (aprovação) |
| 3 | Estorno Cartão de Crédito | Financeiro | Adquirente (manual) |
| 4 | Devolução de OS com Saldo | Financeiro | -- |
| 5 | Solicitação de Reembolso | Natan (aprovação) | -- |
| 6 | Solicitação de Pagamentos | Natan (aprovação) | -- |
| 7 | Solicitação de Impressões | TI | Envio por malote |
| 8 | Autorizações Dataweb | Responsável Dataweb | -- |
| 9 | Suporte Técnico Geral | TI | Terceiros (manual) |
| 10 | Compra de Funcionário | Natan (aprovação) → RH | -- |

Os nomes e telefones dos responsáveis são configurados na interface, não hardcoded.

## Implementação Técnica

### Migration SQL
1. Criar tabela `fluxo_responsaveis` com RLS
2. Criar novas colunas no pipeline Financeiro e TI: "Estorno Solicitado", "Devolução OS", "Reembolso", "Pagamentos", "Impressões", "Autorização Dataweb", "Suporte Técnico", "Compra Funcionário"
3. Inserir 10 registros em `bot_fluxos` com etapas, acao_final e referência de responsável
4. Inserir registros em `bot_menu_opcoes` para os novos fluxos

### `supabase/functions/bot-lojas/index.ts`
- No `executarAcaoFinal`, após `createFinanceiroSolicitacao`, buscar responsáveis em `fluxo_responsaveis` e enviar notificação WhatsApp via `send-whatsapp` ou template
- Mensagem ao responsável: "Nova solicitação: [Tipo] | Loja: [Nome] | [Resumo dos dados]. Acompanhe no pipeline."

### `src/components/configuracoes/BotFluxosCard.tsx`
- Adicionar seção "Responsáveis" no dialog de edição de fluxo
- CRUD de responsáveis (nome, telefone, tipo primário/contingência)

### `src/components/configuracoes/FluxoResponsaveisSection.tsx` (novo)
- Componente para listar/adicionar/remover responsáveis de um fluxo

## Arquivos afetados

| Arquivo | Mudança |
|---------|---------|
| Migration SQL | Tabela `fluxo_responsaveis`, colunas pipeline, 10 fluxos + menus |
| `supabase/functions/bot-lojas/index.ts` | Notificar responsável após ação final |
| `src/components/configuracoes/BotFluxosCard.tsx` | Seção de responsáveis no editor de fluxo |
| `src/components/configuracoes/FluxoResponsaveisSection.tsx` | Novo componente CRUD responsáveis |

## Resultado

- Todo fluxo tem um responsável configurável com telefone cadastrado
- Ao criar solicitação, responsável é acionado automaticamente via WhatsApp
- Fluxos com aprovação (Reembolso, Pagamentos, Compra Funcionário) têm contingência para autorização
- Responsáveis acompanham tarefas no pipeline do setor correspondente
- Interface administrativa permite trocar responsáveis sem deploy

