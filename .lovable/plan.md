
## Objetivo
Criar o setor **Estoque de Armações** com pipeline próprio e um primeiro fluxo end-to-end: o estoquista abre uma **Solicitação de Confirmação de Peça** (ref., código, foto opcional, observação) → vira **Demanda** privada para a(s) loja(s) via Atrium Messenger → loja confirma **Tem / Não tem** com botões + observação → card no Kanban do estoque acompanha o status em tempo real, com lembrete a cada 15 min até a loja responder. Garantias ficam fora desta etapa (apenas a coluna placeholder, sem fluxo).

## Pipeline e setor (migration)
- `setores`: inserir `Estoque de Armações` (slug `estoque_armacoes`).
- `pipeline_colunas` para o setor, na ordem:
  1. **Aguardando loja** (entrada, `tipo_acao = confirmacao_estoque_pendente`)
  2. **Peça confirmada em estoque** (`tipo_acao = confirmacao_estoque_ok`)
  3. **Sem estoque** (`tipo_acao = confirmacao_estoque_sem`)
  4. **Faturada** (terminal positiva, manual pelo estoquista)
  5. **Cancelada** (terminal negativa)
  6. **Garantias** (placeholder — sem automação por enquanto)
- Cria role `setor_usuario` ligada ao novo setor; usuários do estoque entram pela UI existente de Gestão de Usuários.

## Nova entidade: `confirmacoes_estoque`
Tabela enxuta, vinculada ao pipeline e à(s) demanda(s) geradas. Evita poluir `solicitacoes` (que é client-facing).

Campos chave: `id`, `protocolo` (`CEA-AAAA-NNNNN`), `referencia` (obrig.), `codigo_produto` (obrig.), `descricao_peca`, `foto_url` (opcional, bucket `estoque-confirmacoes`), `observacao_estoque`, `loja_nome` (1 por card; broadcast multi-loja gera 1 card por loja), `pipeline_coluna_id`, `status` (`aguardando` | `confirmada` | `sem_estoque` | `faturada` | `cancelada`), `resposta_loja` (`sim` | `nao` | null), `resposta_observacao`, `respondida_por`, `respondida_at`, `tentativas_lembrete`, `proximo_lembrete_at`, `solicitante_id`, `demanda_id` (FK lógica para `demandas_loja`), timestamps. Sequence própria para o `numero_curto`. RLS: setor_operador do Estoque + admin + service_role; loja vê só via demanda (já existe).

Bucket público novo: `estoque-confirmacoes` (foto da peça).

## Integração com o canal de demandas (reuso, sem reinvento)
Reutiliza tudo que já existe (`criar-demanda-loja`, `bridge-demanda`, `mensagens_internas`, `notificacoes`, `dispatch-push`, `DemandaThreadView`).

- Nova edge function **`criar-confirmacao-estoque`** (chamada pelo botão "Nova solicitação de confirmação"):
  1. Valida payload (zod: referencia/codigo obrigatórios, foto opcional <=5MB, observação <=500 char, ao menos 1 loja).
  2. Para cada loja selecionada: cria `confirmacoes_estoque` na coluna **Aguardando loja**, gera protocolo, faz upload da foto se houver.
  3. Chama `criar-demanda-loja` (modo interno, `X-Internal-Caller`) com:
     - `tipo_chave = 'confirmacao_estoque'`
     - `assunto = 'Confirmação de peça em estoque — REF X • COD Y'`
     - `pergunta` = template padronizado (REF, COD, descrição, observação, foto via anexo) + instrução "Responda com os botões abaixo".
     - `metadata = { confirmacao_estoque_id, foto_url, referencia, codigo }`.
  4. Atualiza `confirmacoes_estoque.demanda_id` e seta `proximo_lembrete_at = now() + 15min`.

- **Botões "Tem / Não tem" + observação** dentro do `DemandaThreadView` (Atrium):
  - Renderizar bloco de ação quando `demanda.metadata.tipo_chave === 'confirmacao_estoque'` e usuário é da loja destino e `status != encerrada`.
  - 2 botões grandes (✅ Tenho a peça / ❌ Não tenho) + campo de observação opcional.
  - Ao clicar chama nova EF **`responder-confirmacao-estoque`** que:
    - Atualiza `confirmacoes_estoque` (`resposta_loja`, `resposta_observacao`, `respondida_por/_at`).
    - Move o card para **Peça confirmada** ou **Sem estoque** via update de `pipeline_coluna_id` (dispara `pipeline-automations` via trigger existente).
    - Insere `demanda_mensagens` `direcao='loja_para_operador'` com o conteúdo formatado ("✅ Tenho a peça. Obs: …").
    - Encerra a demanda com `encerrado_por='loja'` (reusa `encerrar-demanda-loja`) — alinhado ao padrão financeiro/garantias.
    - Cria `notificacoes` + push para o solicitante (estoquista).

- **Mensagens livres + observações na abertura**: tudo que loja escrever fora dos botões continua entrando pela bridge atual em `demanda_mensagens` e aparece na thread do estoquista (sem alterar o card). Só o clique nos botões muda o status.

## Lembrete 15 em 15 min (Atrium-only)
- Novo cron `confirmacao-estoque-watchdog` (a cada 1 min) registrado em `cron_jobs`, payload `{ intervalo_min: 15, max_tentativas: 4 }`.
- Edge function **`watchdog-confirmacao-estoque`**:
  - Busca cards com `status='aguardando'` e `proximo_lembrete_at <= now()`.
  - Para cada um: insere `notificacoes` (com `setor_id` resolvido por `resolver_destinatarios_loja(loja_nome)`) → trigger atual dispara push automaticamente.
  - Insere mensagem de sistema na própria thread da demanda (`direcao='sistema'`, "⏰ Lembrete: aguardando confirmação há X min").
  - Incrementa `tentativas_lembrete`, recalcula `proximo_lembrete_at = now() + 15min`.
  - Ao atingir `max_tentativas` (1h): cria `tarefa` para o supervisor do setor Estoque ("Loja não respondeu — escalar") e para de re-disparar. Card permanece em **Aguardando loja** até resposta ou cancelamento manual.

## UI
- Nova rota `/pipeline-estoque` + entrada na sidebar (gated por setor Estoque ou admin), seguindo o esqueleto de `PipelineFinanceiro.tsx`:
  - Kanban com as 6 colunas e drag-and-drop (só admins arrastam entre colunas terminais; loja-driven é via botões).
  - Botão **"Nova solicitação de confirmação"** abre `NovaConfirmacaoEstoqueDialog`:
    - Campos: referência*, código*, descrição, observação, upload de foto, multiselect de lojas (reusa `useLojas`).
    - Submit → `criar-confirmacao-estoque`.
  - Card mostra: protocolo, REF/COD, loja, thumb da foto, tempo aguardando, contador de lembretes, atalho "Abrir demanda" → `/demandas?demanda=<id>`.
  - Drawer lateral / dialog do card embute a `DemandaThreadView` da demanda vinculada (reuso direto), e mostra ações terminais (Faturar / Cancelar) para o estoquista.
- Em `DemandaThreadView`: bloco condicional de botões + observação para `tipo_chave='confirmacao_estoque'` (loja).

## Hooks e tipos
- `useConfirmacoesEstoque` (lista + realtime em `confirmacoes_estoque`).
- `useCreateConfirmacaoEstoque`, `useResponderConfirmacaoEstoque`.
- Tipos em `src/types/database.ts` (`ConfirmacaoEstoque`, status enum string).
- Reusa `useDemandas` / `useDemandaMensagens` para a thread.

## Memória a criar
- `mem://setor/estoque-armacoes-pipeline` — colunas, fluxo confirmação, lembretes 15min, garantias placeholder.
- `mem://funcionalidades/confirmacao-estoque-botoes` — botões Tem/Não tem na thread quando `tipo_chave='confirmacao_estoque'`.

## Fora do escopo (próxima iteração)
- Entrada de NF no estoque.
- Fluxo completo de garantias (apenas coluna placeholder).
- Integração automática com e-commerce (hook ficará pronto via `criar-confirmacao-estoque`, mas sem caller externo).
- Confirmação pelo WhatsApp da loja (por ora só Atrium; mensagens livres por WhatsApp já chegam na thread via bridge).

## Detalhes técnicos resumidos
```text
Estoquista (UI)
   │ NovaConfirmacaoEstoqueDialog
   ▼
criar-confirmacao-estoque (EF)
   ├─► confirmacoes_estoque (status=aguardando, coluna=Aguardando loja)
   └─► criar-demanda-loja (tipo_chave=confirmacao_estoque)
            └─► mensagens_internas → bridge-demanda → demanda_mensagens
                  + push/notificacoes para usuários da loja

Loja (Atrium)
   │ DemandaThreadView → botões Tem / Não tem (+ obs)
   ▼
responder-confirmacao-estoque (EF)
   ├─► update confirmacoes_estoque (resposta, status, coluna)
   ├─► demanda_mensagens (loja_para_operador)
   ├─► encerrar-demanda-loja (encerrado_por=loja)
   └─► notificacao + push para estoquista

Cron 1min → watchdog-confirmacao-estoque
   • re-notifica loja a cada 15min (push + msg sistema)
   • após 4 tentativas → tarefa para supervisor
```
