## Visão geral

Três entregas relacionadas:

1. **Calendário de agendamentos no app InFoco Messenger** — nova tela que lista, em formato calendário, os agendamentos da loja do usuário logado, com card detalhado por agendamento (cliente, horário, status, observações/resumo, valores).
2. **Captura do WhatsApp do cliente no fluxo "Gerar Link de Pagamento"** — adicionar campo obrigatório `cliente_whatsapp` na etapa do fluxo `link_pagamento`.
3. **Envio automático do link de pagamento ao cliente via WhatsApp** — após gerar o link, disparar template aprovado para o número informado, abrindo conversa com o cliente.

---

## Parte 1 — Calendário no Messenger (projeto InFoco Messenger)

### Tela nova: `/agenda`
- Rota nova em `src/App.tsx` apontando para `src/pages/LojaAgenda.tsx`.
- Item novo no `AppShell.tsx` (ícone `Calendar`), `lojaOnly: true`, com badge opcional de agendamentos do dia.
- Visível apenas para `tipo_usuario` loja/colaborador (já há `useLojaContext`).

### Layout
- **Header**: nome da loja + seletor de mês (setas anterior/próximo) + botão "Hoje".
- **Vista mensal compacta** (mobile-first): grid 7 colunas; cada dia mostra contador de agendamentos com cor por status dominante (`agendado` neutro, `lembrete_enviado` azul, `confirmado` verde, `no_show` vermelho, `compareceu` verde escuro).
- **Lista do dia selecionado** (abaixo do grid): cards rolando verticalmente.
- **Vista alternativa "Lista"** (toggle no topo): apenas próximos 30 dias em lista cronológica.

### Card de agendamento
Cada card exibe:
- Horário em destaque (`HH:mm`) + badge de status colorido.
- Nome do cliente (de `contatos.nome` via join) e telefone mascarado.
- Observações/resumo do atendimento (campo `observacoes`).
- Se houver `valor_orcamento` ou `valor_venda`, mostra valores; se `numeros_os` preenchido, lista OS.
- Indicadores: `loja_confirmou_presenca`, `lembrete_enviado`.
- Ação rápida: "Confirmar presença do cliente" (toggle de `loja_confirmou_presenca` quando `status='compareceu'` ainda não houver).
- Tap no card abre detalhe (drawer/modal) com toda observação completa, metadata relevante e link "Ver atendimento" caso `atendimento_id` exista (no-op por enquanto, apenas exibe id).

### Dados
- Query Supabase direta a `agendamentos` filtrando `loja_nome = lojaContext.lojaNome` no intervalo do mês visível, com join em `contatos(nome, telefone)`.
- RLS atual já permite `authenticated` ler tudo; segurança de loja é enforced pelo filtro client-side (consistente com `LojaMinhasDemandas`).
- Realtime opcional: subscribe em `agendamentos` filtrado por `loja_nome` para refresh automático.

### Notificação (já existente)
A loja já recebe notificações de agendamento/lembrete/no-show via push (`agendamentos-cron` + `pipeline-automations`). Sem mudança nesse fluxo — o calendário é apenas a visão consolidada.

---

## Parte 2 — Capturar WhatsApp do cliente no link de pagamento

### Banco
Atualizar `bot_fluxos.etapas` da chave `link_pagamento` (UPDATE via tool de inserção):

Etapas finais (ordem):
1. `valor` (decimal, obrigatório) — já existe
2. `descricao` (texto, obrigatório) — já existe
3. `parcelas` (inteiro, obrigatório) — já existe
4. `cliente` (texto, obrigatório agora) — passa de opcional a obrigatório (já vinha sendo coletado)
5. **NOVO** `cliente_whatsapp` (tipo_input `texto`, obrigatório, validação min 10/max 15 dígitos) com mensagem "📱 WhatsApp do cliente (com DDD, ex: 11999998888) — receberá o link"

### Frontend Messenger
Como o `LojaNovaDemanda.tsx` já renderiza dinamicamente as etapas vindas de `bot_fluxos`, o novo campo aparece automaticamente. Adicionar apenas:
- Validador local extra para `cliente_whatsapp`: aceita só dígitos após sanitização, exige 10–13 dígitos (BR).
- Máscara visual leve (mostrar `(11) 99999-9999`).

### Backend
- `supabase/functions/criar-solicitacao-loja/index.ts` (projeto Atrium): após chamar OB e receber `payment_link_id` + `url_pagamento`, executar **novo passo de notificação ao cliente** (descrito na Parte 3) usando `dados.cliente_whatsapp` e `dados.cliente`.
- O telefone vai para `metadata.cliente_whatsapp` da `solicitacao` para auditoria.

---

## Parte 3 — Envio do link de pagamento ao cliente via WhatsApp

### Novo template Meta
Cadastrar em `whatsapp_templates` (status `rascunho` → submeter à Meta pelo painel existente):

- **Nome**: `link_pagamento_cliente`
- **Categoria**: UTILITY
- **Idioma**: pt_BR
- **Variáveis**: `{{1}}` = nome cliente, `{{2}}` = nome loja, `{{3}}` = valor formatado, `{{4}}` = descrição, `{{5}}` = URL
- **Body sugerido**:
  ```
  Olá {{1}}! Aqui é da {{2}}.
  
  Segue seu link de pagamento:
  💳 Valor: R$ {{3}}
  📝 {{4}}
  
  🔗 {{5}}
  
  Pague com cartão em até várias parcelas. Qualquer dúvida, é só responder por aqui.
  ```
- `funcao_alvo`: `criar-solicitacao-loja`

### Novo passo em `criar-solicitacao-loja`
Após `payment_link_id` retornar com sucesso e antes de responder ao app, fazer:

1. Sanitizar `cliente_whatsapp` (`+55` + DDD + número, só dígitos).
2. **Upsert em `contatos`** (PK telefone, conforme regra do projeto): `nome = dados.cliente`, `telefone = numeroSanitizado`, `tipo = 'cliente'`, `metadata.origem = 'link_pagamento_loja'`.
3. Invocar EF interna `send-whatsapp-template` com:
   - `contato_id` do upsert
   - `template_name = 'link_pagamento_cliente'`
   - `template_params = [primeiroNome, nomeLoja, valorFormatado, descricao, url]`
4. Registrar `eventos_crm` tipo `link_pagamento_enviado_cliente` com `referencia_id = solicitacao.id` e metadata (telefone mascarado, payment_link_id).
5. Falha no envio: NÃO bloqueia o sucesso da solicitação — apenas marca `metadata.envio_cliente_status='falhou'` e retorna campo `cliente_envio_status` no response para o app exibir aviso.

### Resposta ao app
O `Resultado` na tela de sucesso do Messenger ganha:
- Linha extra: "✅ Link enviado para WhatsApp de {{cliente}}" ou alerta amarelo "Link gerado, mas não foi possível enviar ao cliente — copie e envie manualmente".

### Gate de template
O `send-whatsapp-template` já bloqueia disparo se template não estiver `approved`. Enquanto `link_pagamento_cliente` estiver pending/rascunho, o app exibirá o alerta amarelo automaticamente — comportamento desejado.

---

## Resumo técnico (arquivos)

**Atrium (este projeto):**
- `supabase/functions/criar-solicitacao-loja/index.ts` — adicionar bloco de upsert de contato + chamada `send-whatsapp-template` após `OB` retornar com sucesso, somente quando `acao.endpoint === 'payment-links'`.
- Migração SQL (UPDATE em `bot_fluxos` para etapas do `link_pagamento`) + INSERT em `whatsapp_templates` (`link_pagamento_cliente` rascunho).

**InFoco Messenger (projeto cross):**
- `src/App.tsx` — nova rota `/agenda`.
- `src/components/AppShell.tsx` — novo item de nav `Agenda` (loja-only).
- `src/pages/LojaAgenda.tsx` — nova página (calendário mensal + lista do dia + cards).
- `src/pages/LojaNovaDemanda.tsx` — máscara/validação extra para `cliente_whatsapp`; exibir status de envio ao cliente na tela de sucesso.

**Memória:**
- Atualizar `mem://integracao/templates-whatsapp-catalogo.md` com o novo template `link_pagamento_cliente`.

---

## Pontos a confirmar

1. O campo `cliente` deve passar a obrigatório (hoje é opcional)? — proposta sim, já que vamos endereçar o link no nome do cliente.
2. Calendário deve incluir agendamentos com status terminais (`compareceu`, `cancelado`, `no_show`) ou só ativos? — proposta: mostrar todos com filtro padrão "ativos" e toggle "mostrar histórico".
3. Loja deve poder editar/cancelar agendamento direto pelo card? — proposta inicial: somente leitura + ação "confirmar presença"; edição fica para iteração futura.
