

## Diagnóstico

A loja Teste respondeu ao número oficial e o webhook criou um card novo no CRM como se fosse cliente ("Franciana"). Causa raiz provável:

1. **Webhook não detectou que o telefone é corporativo** antes de criar contato/atendimento. Deveria checar `telefones_lojas` no início do fluxo de inbound e:
   - NUNCA criar contato como `tipo='cliente'`
   - NUNCA inserir no pipeline CRM
   - Rotear direto pra thread da demanda aberta (já implementamos auto-routing, mas só funciona se o atendimento já existir como "espelho da loja"; se webhook criou um atendimento novo de cliente, passou por fora)
2. **Trigger `sanitize_corporate_contact`** existe e corrige tipo/setor — mas roda só quando `telefones_lojas` muda. Não roda no momento que o webhook cria o contato. Resultado: contato nasce como cliente e fica até alguém mexer no cadastro da loja.
3. **"Franciana"** é o `senderName` do WhatsApp da loja (nome do dono do número). Sem checagem corporativa, virou nome do "cliente novo".

## Investigação a confirmar (default mode)

- SQL: `contatos` com telefone da Loja Teste — quantos registros existem? Algum criado agora? Tipo atual?
- SQL: `atendimentos` recentes desse telefone — qual `solicitacao_id`, `pipeline_coluna_id` da solicitação, `metadata`?
- `whatsapp-webhook/index.ts` — ler o trecho de criação de contato/atendimento pra inbound e identificar onde falta o early-check corporativo.
- `criar-demanda-loja/index.ts` — confirmar que o atendimento espelho da loja foi criado com telefone exato e que o webhook deveria ter encontrado.

## Causa específica do "novo card Franciana"

Hipótese forte: o atendimento espelho criado por `criar-demanda-loja` foi achado pelo auto-routing OU não foi (verificar). Mas o webhook **também** seguiu o fluxo padrão e criou um segundo registro/card no CRM (Franciana). Provavelmente o auto-routing está gravando a msg na thread da demanda **mas não está dando `return` cedo o suficiente** — o resto do webhook continua e cria o cliente.

## Plano

### 1. Hard-guard corporativo no `whatsapp-webhook` (raiz do problema)
No início do processamento inbound, ANTES de criar/buscar contato:
- Lookup em `telefones_lojas` por telefone normalizado.
- Se encontrado:
  - Forçar `contatos.tipo = loja|colaborador` (upsert).
  - Forçar `contatos.setor_destino = setor_destino_id` da loja (ou `Atendimento Corporativo` default).
  - Forçar `contatos.pipeline_coluna_id = NULL` (NUNCA entrar no CRM de vendas).
  - **Ignorar `senderName`** do WhatsApp se contato já existe (não sobrescrever nome cadastrado da loja).
  - Se `senderName` veio e contato é novo, usar `nome_loja` da `telefones_lojas`, não o `senderName`.

### 2. Auto-routing precisa ser terminal
Quando há demanda aberta pra essa loja:
- Gravar msg na thread (`demanda_mensagens`).
- Atualizar `demandas_loja.vista_pelo_operador=false, ultima_mensagem_loja_at=now()`.
- Notificar operador (`notificacoes` pro `solicitante_id`).
- **`return` imediato** — não chamar bot-lojas, não chamar IA, não criar/atualizar atendimento de cliente, não criar solicitação no CRM.
- A msg também é gravada em `mensagens` do atendimento espelho (pra histórico WhatsApp), mas sem efeitos colaterais no CRM.

### 3. Limpeza do estrago atual
Migration / SQL pontual:
- Achar contato "Franciana" criado agora pra esse telefone, mergear com o contato real da Loja Teste (mover msgs/atendimentos), deletar o duplicado OU só corrigir tipo/setor/coluna.
- Rodar `sanitize_corporate_contact` pro telefone da Loja Teste.

### 4. UI: card da demanda mostra a resposta
No `DemandaLojaPanel` / `DemandaThreadDialog`:
- Garantir que toda nova msg na thread aparece em tempo real (Realtime na `demanda_mensagens` por `demanda_id`).
- Badge "🟡 Resposta nova" no card quando `vista_pelo_operador=false`.
- Marcar `vista_pelo_operador=true` ao abrir a thread.

### 5. Memory update
Atualizar `mem://bot-lojas/canal-demandas-privado.md` e `mem://crm/fila-prioridade-humana.md`:
- Webhook DEVE checar `telefones_lojas` antes de qualquer criação de contato.
- Auto-routing pra demanda é terminal (return imediato, sem efeitos no CRM).

## Arquivos afetados

- `supabase/functions/whatsapp-webhook/index.ts` — early corporate guard + auto-routing terminal.
- `supabase/functions/criar-demanda-loja/index.ts` — garantir que contato espelho da loja seja upserted com tipo/setor corretos (idempotente).
- Migration/SQL — limpar contato "Franciana" duplicado e rodar `sanitize_corporate_contact`.
- `src/components/atendimentos/DemandaLojaPanel.tsx` + `DemandaThreadDialog.tsx` — Realtime + marcar como vista.
- `mem://bot-lojas/canal-demandas-privado.md` + `mem://crm/fila-prioridade-humana.md` — atualizar regras.

## Resultado

Loja Teste responde → webhook detecta corporativo → grava direto na thread da demanda → operador vê no card original → nenhum card cliente "Franciana" criado. Próxima msg da loja sem demanda ativa cai no bot-lojas (menu corporativo) — nunca no CRM de vendas.

