## Implementação: CPF aprovado consumido + ciclo de revisão de boleto

### Defaults assumidos (sem bloqueio para confirmar — ajustáveis depois)
- Cancelamento do boleto: somente Financeiro (loja só pede revisão).
- Limite de ciclos: **3** (grava em `app_config.boleto_max_ciclos_revisao`).
- Janela de revisão: enquanto card não estiver arquivado (sem prazo fixo).

### Parte 1 — CPF aprovado some da lista (já está OK)
Verifiquei `criar-solicitacao-loja`: ele já grava `boleto_solicitacao_id` + `boleto_gerado_at` na consulta CPF origem (linhas 484-486) e o filtro do Messenger já ignora consultas com `boleto_solicitacao_id IS NOT NULL`. **Nada a mudar no Atrium.** Confirmar no Messenger só que a mensagem de bloqueio aparece quando o usuário tenta abrir consulta já consumida.

### Parte 2 — Ciclo de revisão loja↔financeiro

**Migration (já aplicada):**
- Ativada coluna **"Boleto Enviado"** (estava oculta) e marcada como `terminal=false` com `dias_auto_arquivar=7` (auto-arquiva 7d após enviar).
- Criada coluna **"Boleto em Revisão"** no Financeiro (ordem 6, `tipo_acao=revisao_boleto`, não terminal).
- `app_config.boleto_max_ciclos_revisao = 3`.

**Nova EF `solicitar-revisao-boleto`** (chamada pelo Messenger):
- Valida boleto em status `enviado` e ciclo atual `< maxCiclos`.
- Move card "Boleto Enviado" → "Boleto em Revisão".
- Grava `metadata.boleto_revisao = {ciclo, motivo, campos_revisar[], solicitada_em, solicitada_por}` e zera `arquivado_at`.
- Insere `solicitacao_comentarios` (tipo `loja_para_operador`) + espelha em `demanda_mensagens`.
- Notifica usuários do Financeiro via `resolver_destinatarios_setor('Financeiro')`.
- Registra evento `boleto_revisao_solicitada` em `pipeline_card_eventos`.

**Update EF `concluir-solicitacao-financeiro`** — novo modo `boleto-revisao`:
- Mesmo upload múltiplo do modo `boleto`.
- Append em `metadata.boleto_anexos_historico[]` com `{ciclo, enviado_em, urls[]}`; `boleto_arquivos` passa a refletir só a versão atual.
- Move de volta para **"Boleto Enviado"** + reseta `metadata.entrou_terminal_em = now()` (contador de auto-arquivamento recomeça).
- Mensagem na thread com tag "🔄 Boleto revisado (ciclo N)".
- Evento `boleto_revisao_concluida`.

**`PipelineFinanceiro.tsx`:**
- Card: badge âmbar **"🔄 Revisão pedida — ciclo N"** quando `metadata.boleto_revisao` existe e card está em "Boleto em Revisão".
- Dialog detalhe: bloco mostrando motivo da revisão + campos pedidos + histórico de anexos anteriores (read-only, link para cada arquivo).
- Botão **"Reenviar boleto revisado"** abre `ConcluirSolicitacaoDialog` em modo `boleto-revisao` quando card em "Boleto em Revisão".
- Cancelamento usa o `CancelarSolicitacaoDialog` existente (vai para "Cancelado").

**`ConcluirSolicitacaoDialog.tsx`:**
- Aceitar `modo = "boleto-revisao"` (mesma UI do `boleto`, só muda título: "Reenviar boleto revisado" + botão "Reenviar N boleto(s)").

**`CardTimeline.tsx`:**
- Renderizar 2 novos `tipo` de evento: `boleto_revisao_solicitada` (ícone 🔄 amber) e `boleto_revisao_concluida` (ícone ✓ green).

### Instruções para o Messenger (projeto separado)
Depois que esta entrega subir, no projeto **InFoco Messenger** o time precisa:

1. **Wizard "Gerar Boleto"** (passo 1):
   - Listar CPFs aprovados elegíveis: `tipo='consulta_cpf'` + `metadata.resultado_consulta='aprovado'` + mesma loja + ≤60d + `metadata.boleto_solicitacao_id IS NULL`.
   - Se usuário tentar selecionar consulta já consumida (lista cacheada ou link direto): bloquear com mensagem **"Esta consulta já originou o boleto #PROTOCOLO em DD/MM/AAAA. Para outro boleto, abra uma nova consulta de CPF."**

2. **Tela da demanda — boleto recebido:**
   - Exibir anexos com badges 🖨️/📱 conforme `metadata.boleto_impresso`.
   - **Novo botão "Solicitar revisão do boleto"** disponível quando `metadata.boleto_status === 'enviado'` e ciclo atual `< boleto_max_ciclos_revisao` (ler `app_config`).
     - Form: motivo (textarea obrigatório, ≥5 chars) + checkboxes opcionais (valor / parcelas / vencimento / dados do cliente).
     - Submit → `supabase.functions.invoke("solicitar-revisao-boleto", { body: {solicitacao_id, motivo, campos_revisar} })`.
     - Após sucesso: thread mostra automaticamente o novo comentário; botão desabilita até nova versão chegar.
   - Quando atinge limite: mensagem "Limite de revisões (3) atingido. Abra um novo pedido de boleto."

3. **Histórico:** se quiser, listar `metadata.boleto_anexos_historico[]` para a loja ver versões anteriores também.

### Para mim agora
Os bullets acima (EF + dialog + pipeline + timeline) precisam ser executados em build mode — peça para alternar para implementar.

---

### Status das alterações anteriores (auditoria rápida do que você pediu até aqui)
- ✅ Tabela `os_recebimento_loja` + EF `confirmar-recebimento-os` + cron `regua-disparo-aguardando-armacao` (07:00 SP, pula domingo).
- ✅ Templates v2 (`aguardando_armacao_v2`, `os_recebida_loja_v2`) — submetidos à Meta.
- ✅ Gate de loja obrigatória no agendamento via `ai-triage`.
- ✅ Validação PIN + LGPD em `regua_inscricao`, página `/termos-cashback`.
- ✅ Visão 360 (`/crm/contatos/:id` + RPC `contato_timeline` + `Cliente360Drawer`).
- ✅ Reconciliação cashback D+1 (cron 07:00, auto-aprovação + auditoria divergências).
- ✅ Auto-reabertura janela 24h Meta (cron 08:00 + banner no chat).
- ✅ Plano de contingência bridge Firebird (`bridge_sync_log` + painel `/configuracoes/bridge-saude`).
- ✅ Painel de Disparos CRM (`vw_disparos_unificados` + `/relatorios/disparos`).
- ✅ Normalização de telefone + log `telefone_invalido` para aguardando armação.
- ✅ Wizard boleto backend: `criar-solicitacao-loja` valida parcelas/vencimento + gera `boleto_parcelas_projecao`.
- ✅ Auto-arquivamento: cron `auto-arquivar-cards-diario` ativo (jobid 15, 03:30 SP) — 1ª rodada arquiva ~37 cards antigos.
- ✅ Apresentação do boleto reorganizada no Kanban + dialog (bloco picote âmbar).
- ✅ Flag `boleto_impresso` é apenas sinal da loja na abertura — checkbox removido do dialog do Financeiro.
- ⏳ **Esta entrega** (Parte 2 acima): ciclo de revisão de boleto.
