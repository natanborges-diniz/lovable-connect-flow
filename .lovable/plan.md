
# Revisão das aberturas de demanda da loja + ações no card do operador

Foco: 4 fluxos do app InFoco Messenger que hoje "entram cegos" no Financeiro — sem dados suficientes e/ou sem botão de ação para o operador. Link de Pagamento fica intocado (já funciona).

## Fluxos revisados

### 1. Estorno Cartão de Crédito (`estorno_cartao`)
**Hoje:** pede só `numero_venda`, `valor`, `motivo`. Card cai em "Estorno Solicitado" sem ações.

**Novo formulário no Messenger (perguntas em ordem):**
- 🔢 Nº da OS / venda
- 📅 Data do processamento do cartão
- 🔑 NSU da transação
- 💰 Valor total processado
- 💵 Valor a cancelar (parcial ou integral)
- 📝 Motivo do estorno

**Novas ações no card (operador Financeiro):**
- **"Estorno solicitado"** → marca `metadata.estorno_status='solicitado'`, registra data/operador, move para coluna "Estorno em Andamento" (criar se não existir) e avisa a loja via Messenger "Estorno foi solicitado à adquirente. Aguardando retorno."
- **"Concluir com carta"** → abre dialog que exige upload obrigatório da carta de devolução (PDF/imagem). Ao confirmar: anexa em `solicitacao_anexos`, encerra o card, dispara mensagem na demanda Messenger: "Estorno concluído. Segue a carta para enviar ao cliente." + anexo.
- **"Devolver à loja"** (já existe `DevolverLojaDialog`) — campo "O que está faltando?" com presets ("NSU incorreto", "Valor divergente", "Falta carta do cliente", "Outro"). Card permanece em aberto, status `metadata.pendencia_loja=true`; loja recebe a observação no Messenger e pode reenviar dados/anexos pela própria thread.

### 2. Solicitação de Pagamentos (`pagamento`) — fornecedor
**Hoje:** pede `favorecido`, `valor`, `vencimento`, `descricao`. Sem CNPJ, sem dados bancários, sem anexo, sem ação no card.

**Novo formulário no Messenger:**
- 👤 Fornecedor / favorecido
- 🆔 CNPJ ou CPF do favorecido
- 💰 Valor
- 📅 Vencimento (`data` validada)
- 🏦 Forma de pagamento (PIX / Boleto / TED)
- 🔑 Chave PIX / código de barras / dados bancários (condicional pela forma)
- 📝 Descrição (serviço/produto)
- 📎 Anexo da nota/boleto (obrigatório)
- 🏢 Centro de custo (loja ou setor — `selecionar_loja_ou_setor`)

**Novas ações no card:**
- **"Devolver à loja"** (presets: "Falta CNPJ do favorecido", "Chave PIX inválida", "Anexo ilegível", "Outro").
- **"Aprovar"** → move para "Aguardando Pagamento".
- **"Concluir pagamento"** → dialog exige upload do **comprovante de pagamento** + campos NSU/data. Ao confirmar: encerra card e envia comprovante (padrão picote verde já existente, reaproveitado) para a loja na thread Messenger.

### 3. Solicitação de Reembolso (`reembolso`)
**Hoje:** já tem comprovante de gasto. Falta dados bancários do solicitante e ações de conclusão.

**Adicionar etapas:**
- 🏦 Forma de reembolso (PIX / depósito em folha)
- 🔑 Chave PIX (se PIX)

**Novas ações no card:** mesmas 3 do Pagamento (Devolver / Aprovar / Concluir com comprovante).

### 4. Estorno PIX/Débito (`estorno_pix_debito`)
**Adicionar etapas:**
- 📅 Data do processamento
- 🔑 NSU/EndToEnd
- 💰 Valor original

**Ações no card:** mesmas do Estorno Cartão (Solicitado / Concluir com carta-ou-comprovante / Devolver à loja).

## Comportamento transversal (todos os fluxos)

- Toda devolutiva ao operador (concluir/devolver) é espelhada na thread da demanda no Messenger via `bridge-demanda` (já existente — basta gravar em `demanda_mensagens` com `direcao='operador_para_loja'`). A loja vê em modo read-only quando `tipo='retorno_setor'`.
- Comprovante de pagamento usa o mesmo card "picote verde" já implementado para link_pagamento (NSU em destaque), exibido tanto no detalhe do card no operador quanto enviado como mensagem formatada na thread da loja.
- Cards encerrados com sucesso vão para coluna "Concluído" do Financeiro; cards encerrados por cancelamento vão para "Cancelado".

## Implementação técnica

### Backend
1. **SQL/seed** — `UPDATE bot_fluxos SET etapas=... WHERE chave IN ('estorno_cartao','pagamento','reembolso','estorno_pix_debito')` adicionando campos novos com `tipo_input` apropriado (`data`, `cpf_cnpj`, `texto`, `imagem`, `selecionar_loja_ou_setor`).
2. **Edge function nova `concluir-solicitacao-financeiro`** — recebe `solicitacao_id` + payload (carta, comprovante, NSU, valor). Insere em `solicitacao_anexos`, atualiza `solicitacoes.metadata` (estorno_status / pagamento_status / payment_status='PAGO' / nsu / tid / valor / payment_confirmed_at), move para coluna terminal, e cria 1 `demanda_mensagens` com a devolutiva + anexo (via convenção `conversa_id='demanda_<id>'`).
3. Reaproveita `devolver-solicitacao-loja` (já existente) — só adiciona presets no front.
4. **`criar-solicitacao-loja`** — nenhuma mudança de código; passa a usar etapas atualizadas via DB.

### Frontend
1. **Novo dialog** `src/components/financeiro/ConcluirSolicitacaoDialog.tsx`
   - Modos: `carta` (estornos) ou `comprovante_pagamento` (pagamento/reembolso).
   - Upload obrigatório; NSU/valor obrigatórios no modo comprovante.
   - Chama `concluir-solicitacao-financeiro`.
2. **`DevolverLojaDialog`** — adicionar prop `presets?: string[]` para mostrar chips de motivos comuns.
3. **`PipelineFinanceiro.tsx`** — no dialog de detalhe (`!consulta_cpf && !confirmacao_pix`), renderizar bloco "Ações do card" condicionado a `tipo`:
   - `estorno_cartao` / `estorno_pix_debito` → botões: Estorno solicitado · Concluir com carta · Devolver à loja.
   - `pagamento` / `reembolso` → botões: Aprovar · Concluir pagamento · Devolver à loja.
   - Mostrar painel de dados estruturados (lendo `metadata`) antes do raw `descricao`.
4. **Bloco de exibição da carta/comprovante** — quando `metadata.estorno_status='concluido'` ou `payment_status='PAGO'`, mostrar anexo e o picote (já existe para PAGO).

### Memória
Salvar `mem://financeiro/acoes-cards-operador-padrao.md` documentando os 3 botões padrão por tipo e a obrigatoriedade do anexo de conclusão.

## Fora do escopo (intencional)

- Link de Pagamento (`link_pagamento`) — funciona, não mexer.
- Fluxos não-financeiros (autorizacao_dataweb, devolucao_os, impressao, suporte_tecnico, compra_funcionario, confirmar_comparecimento, consulta_cpf, gerar_boleto, confirmacao_pix) — não citados pelo usuário.
- Mudança de schema/colunas em `solicitacoes` — tudo cabe em `metadata`.

## Validação após implementar

1. Abrir cada fluxo no Messenger e ver os campos novos.
2. Verificar que o card no `/financeiro` mostra os botões corretos por tipo.
3. Concluir um estorno fake → conferir que a carta chega na thread Messenger da loja e o card encerra.
4. Devolver com motivo → conferir que a loja recebe a observação e o card continua aberto.
