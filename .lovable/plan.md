# Mover card de cliente para a coluna do ciclo de agendamento na Loja

## Causa raiz (verificada no banco)

Caso da Cláudia (`contato 594b3664…`, agendamento `413a681a…`):
- Agendamento existe na **DINIZ UNIÃO**, status já chegou em `compareceu`, `cliente_confirmou_at` preenchido.
- Contato continua com `pipeline_coluna_id = cad20aaf…` ("**Informações Gerais**", coluna órfã sem setor).
- `pipeline_card_eventos` para esse contato: **0 linhas** — nunca foi movido.
- Setor destino do contato já é "Loja" (`277307f3…`), e o setor Loja tem o pipeline correto:
  `Agendado → Confirmado → Atendido → No-Show → Recuperação → Reagendado → Abandonado → Cancelado`.

Por que não moveu:
1. **`agendar-cliente`** insere em `agendamentos` e chama `notificar-loja-agendamento`, mas **não toca `contatos.pipeline_coluna_id`**.
2. O trigger `trg_agendamento_status_change` dispara `pipeline-automations` **só em UPDATE** (não em INSERT). E mesmo quando dispara, **não existe nenhuma automação `mover_coluna`** cadastrada para nenhum status (`pipeline_automacoes` para entidade `agendamento` só tem `enviar_mensagem`, `enviar_template`, `criar_tarefa`).

Resultado: o card nunca entra no kanban da Loja em nenhuma fase.

## Plano

### 1. Cadastrar automações `mover_coluna` para os status do agendamento

Inserir em `pipeline_automacoes` (entidade=`agendamento`, ativo=true), uma por status, apontando para as colunas do setor Loja:

| status_alvo     | pipeline_coluna_id (destino)            |
|-----------------|-----------------------------------------|
| `agendado`      | `2865b9f1…` (Agendado)                  |
| `confirmado`    | `d4f84dce…` (Confirmado)                |
| `compareceu`    | `f3fe0424…` (Atendido)                  |
| `no_show`       | `a2dcd5c5…` (No-Show)                   |
| `recuperacao`   | `e58657e8…` (Recuperação)               |
| `reagendado`    | `3eb2154b…` (Reagendado)                |
| `cancelado`     | `36f09b5d…` (Cancelado)                 |

`config = { "pipeline_coluna_id": "<id>" }` e `tipo_acao = 'mover_coluna'`.

> O loader `pipeline-automations` já lê automações por `status_alvo` do agendamento e move `contatos.pipeline_coluna_id` (mesma mecânica que envia template/mensagem). Não precisa novo código de execução — só registro de dados.

### 2. Disparar automações também no INSERT (primeiro `agendado`)

Hoje o trigger só roda em `UPDATE`. Duas opções, escolho **(a)** por ser mínima:

(a) **Criar trigger AFTER INSERT** em `agendamentos` que chame `pipeline-automations` com `status_novo=NEW.status`, `status_anterior=NULL` — reaproveitando exatamente a mesma função `on_agendamento_status_change` adaptada (ou nova `on_agendamento_inserted`). Idempotente porque a coluna alvo é fixa por status.

(b) Editar `agendar-cliente` pra chamar `pipeline-automations` direto após insert. Mais código, sem ganho.

### 3. One-shot retroativo para Cláudia

Atualizar `contatos.pipeline_coluna_id` do contato `594b3664…` para `f3fe0424…` (Atendido — status `compareceu`) e registrar evento em `pipeline_card_eventos` (`tipo='movido_retroativo'`, descrição "Backfill ciclo agendamento Loja").

## Não muda

- Texto/comportamento das automações de mensagem/template já existentes.
- Regras de skip por `cliente_confirmou_at` e ordem regressiva.
- Outros setores ou pipelines.
- Frontend (kanban Loja já lista por `pipeline_coluna_id` do setor).

## Riscos / mitigação

- **Cards antigos sem agendamento ativo**: a migração só altera o card via gatilho — agendamentos novos seguem o fluxo, agendamentos antigos não são reprocessados (exceto Cláudia, manual).
- **Múltiplos agendamentos por contato**: ao mudar status, o último update vence — coerente com o que CRM já faz.
- **Lojas que ainda não usam o pipeline Loja**: as colunas são compartilhadas no setor Loja; basta o usuário filtrar por `loja_nome` (já é como o front opera hoje).

Confirma que aplico (1) migration de automações, (2) trigger AFTER INSERT, (3) backfill da Cláudia?
