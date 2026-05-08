
# Plano — Rastreabilidade e fluxos do Pipeline Financeiro

Três entregas conectadas, todas operando dentro do modelo Canal Único (App Atrium / `demandas_loja` + `mensagens_internas` + `notificacoes`).

---

## 1. Excluir / cancelar link de pagamento → reflete na demanda da loja

**Hoje:** o botão de excluir card seta `pipeline_coluna_id=null` e `status='cancelada'` na `solicitacoes`, mas a `demanda_loja` que originou o pedido continua "aberta" no app da loja, sem aviso.

**Vai passar a fazer:**
- Quando o operador clica em excluir o card de link de pagamento:
  - Confirma com dialog ("Cancelar este link?" + campo opcional de motivo).
  - `solicitacoes.status = 'cancelada'` (como hoje) e registra evento de auditoria.
  - Se houver `pagamentos_link` vinculado: `status = 'cancelado'` + `metadata.cancelado_por`/`motivo`.
  - Se houver `demandas_loja` vinculada: `status = 'cancelada'` + posta uma `demanda_mensagens` automática ("Solicitação cancelada pelo Financeiro" + motivo, se houver).
- No app da loja (lista e thread de demandas): card ganha **badge "Cancelado"** (vermelho, semântico) e a thread fica somente leitura.
- Push opcional pra loja só se motivo foi preenchido.

---

## 2. Timeline de auditoria dentro do card (qualquer setor)

**Hoje:** não existe registro de quem moveu/editou o card. `eventos_crm` só rastreia eventos do contato.

**Vai passar a existir:**
- Nova tabela `pipeline_card_eventos` (genérica, serve Financeiro / TI / Interno / Loja / CRM):
  - `entidade` (`solicitacao` | `demanda_loja` | `contato`) + `entidade_id`
  - `tipo` (`movido_coluna`, `comentario`, `devolvido_loja`, `cancelado`, `link_recebido`, `pagamento_aprovado`, etc.)
  - `coluna_anterior_id` / `coluna_nova_id`
  - `usuario_id`, `usuario_nome` (snapshot)
  - `descricao`, `metadata jsonb`
  - `created_at`
- Drag-drop no Kanban passa a inserir um evento `movido_coluna` (autor = `auth.uid()`).
- Cancelamento (item 1), devolução (item 3) e comentários também inserem eventos.
- Drawer do card ganha aba **"Histórico"** com timeline cronológica (autor, ação, observação, timestamp em pt-BR). Reutilizável nos quatro pipelines.

RLS: `authenticated` lê tudo, `service_role` total. Insert via cliente carimbando `usuario_id = auth.uid()`.

---

## 3. Devolver para a loja com motivo + volta automática

**Hoje:** quando o setor move pra coluna tipo "Dados incompletos", nada chega à loja e o ciclo morre.

**Vai passar a funcionar como ping-pong:**

- Coluna ganha flag opcional `tipo_acao = 'devolver_para_loja'` (configurável em `pipeline_colunas.metadata`).
- Quando um card cai numa coluna desse tipo (drag-drop ou automação):
  - Abre dialog **"O que está faltando?"** — texto obrigatório.
  - Cria `demanda_mensagens` (direcao `operador_to_loja`) com o motivo, marca `demandas_loja.status = 'aguardando_complemento'`, dispara push pra loja com título "Pendência: dados faltando — #protocolo".
  - Card ganha tag visual "Aguardando loja" + tempo desde devolução.
- App da loja vê a demanda destacada como **"Aguardando seu retorno"**, com 3 ações:
  1. **Responder** → loja envia complemento (texto/anexo).
  2. **Encerrar/Desistir** → loja explica e cancela; demanda vira `cancelada`, card sai do pipeline com badge "Cancelado pela loja".
  3. **Continuar conversa** (mensagens livres na thread).
- Quando chega resposta da loja (`demanda_mensagens` direcao `loja_to_operador` numa demanda em `aguardando_complemento`):
  - `bridge-demanda` (ou trigger) atualiza `demandas_loja.status = 'respondida'`.
  - Card volta automaticamente para uma coluna marcada como `tipo_acao = 'reentrada_revisao'` (ex.: "Reenviado / Em revisão") no mesmo setor.
  - Push para o operador que fez a devolução (e fallback pro setor todo).
  - Evento `devolvido_pela_loja` na timeline do card.

---

## Detalhes técnicos

**DB (migration):**
- Tabela `pipeline_card_eventos` (com RLS).
- Campos novos em `pipeline_colunas.metadata`: `tipo_acao` (`devolver_para_loja` | `reentrada_revisao` | null).
- Status novos em `demandas_loja.status`: `aguardando_complemento`, `respondida` (já existe na bridge), `cancelada`.
- Trigger em `demanda_mensagens` AFTER INSERT: se demanda estava em `aguardando_complemento` e direcao `loja_to_operador` → muda card para coluna `reentrada_revisao` do mesmo setor + insere evento.

**Frontend:**
- `src/pages/PipelineFinanceiro.tsx` (e demais Pipelines): drawer ganha aba `Histórico`, dialog de cancelamento, dialog de devolução.
- Componente reutilizável `<CardTimeline entidade entidadeId />`.
- `src/components/atendimentos/DemandaThreadView.tsx`: badge Cancelado / Aguardando complemento + botões Responder / Desistir.

**Edge functions:**
- `pipeline-automations`: aceita `tipo_acao=devolver_para_loja` (cria mensagem + atualiza status demanda) e `cancelar_link` (atualiza pagamento + demanda).
- Pequeno ajuste em `bridge-demanda` para reagir a `aguardando_complemento` → `respondida` e mover card.

**Out of scope:**
- Reescrever o pipeline genérico de outros setores além de adotar a timeline (que é universal).
- Notificações por e-mail.
- Métricas/SLA sobre tempo da loja responder (fica para próximo ciclo).

---

## Validação
- Cancelar link no Financeiro → demanda da loja exibe badge "Cancelado" e mensagem do motivo.
- Mover card para "Dados incompletos" → loja recebe push, motivo aparece na thread, status muda.
- Loja responde → card volta sozinho para "Reenviado", evento na timeline.
- Loja desiste → card sai do pipeline com badge "Cancelado pela loja".
- Toda movimentação aparece na aba Histórico com nome do operador.
