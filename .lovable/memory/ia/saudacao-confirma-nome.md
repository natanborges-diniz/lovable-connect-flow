---
name: Saudação inicial confirma/registra nome + vocativo seguro + sequencial anônimo
description: Cascata de display name. Cliente nunca é chamado por telefone ou placeholder. Webhook gera "Cliente #NNNN" interno via sequência; ai-triage tem guardrail vocativo + fast-path + escalada após 3 tentativas.
type: feature
---

## Cascata de display name (3 camadas)

### 1. Webhook (`whatsapp-webhook`) — primeira ingestão
Para contato cliente novo:
- `looksLikeRealName(senderName, phone)` → grava `contatos.nome = senderName` direto.
- Senão → `select public.next_contato_anonimo()` → grava `contatos.nome = 'Cliente #' || lpad(seq, 4, '0')`. Telefone fica em `contatos.telefone` apenas.
- Fallback (sequência indisponível) → grava o telefone como nome (legado).
- Quando `senderName` válido chega depois e `contato.nome` é placeholder (telefone OU `Cliente #NNNN`) → upgrade automático para `senderName`.

### 2. ai-triage — guardrail de vocativo
Helper `nomeEhPlaceholder(s)` reconhece: vazio, ≥7 dígitos, `cliente #NNNN`, "WhatsApp User", "Contato", "Cliente", "Usuário", strings sem letras.

Logo após carregar `contatoNomeAtual`:
- `_nomeInternoSafe` = nome original (para logs, eventos, prompt como "REFERÊNCIA INTERNA").
- Se `contatoNomeAtual` é placeholder mas `nomePerfilWhatsapp` é nome real → usa o WhatsApp como vocativo.
- Senão → `contatoNomeAtual = ""` (todos os templates `${nomeAtual ? ', ' + nomeAtual : ''}` colapsam, evitando saudação tipo "Tô com dificuldade…, 5511949841973").

### 3. Fast-path determinístico (mantido)
- Quando `inboundCount===1` OU `precisaConfirmarNome===true`: extrai nome de inbound texto via `extrairNomeDoInbound()`. Se extraído → persiste com `nome_confirmado=true` e segue para LLM já tratando pelo nome.
- Após 3 tentativas sem reconhecer nome → escala humano com motivo `loop_pedido_nome`.
- Se cliente nunca responder → IA segue ajudando **sem vocativo** (graças ao guardrail).

## Pontos críticos
- `nomeAtual` no objeto passado a `buildSystemPromptFromCompiled` / `buildSystemPrompt` usa `_nomeInternoSafe` (não o sanitizado), para o LLM saber o nome interno como referência sem misturar com vocativo.
- `Cliente #NNNN` é uso EXCLUSIVAMENTE INTERNO (CRM, Kanban, listas). Nunca aparece em mensagens ao cliente — `nomeEhPlaceholder` filtra.
- Telefone como nome (legado em ~147 contatos antigos) também filtrado em runtime — não precisa backfill.

## DB
- Sequência: `public.contatos_anonimo_seq`.
- Função: `public.next_contato_anonimo()` retorna `nextval` (security definer).

## Caso de regressão (14-mai-2026 — telefone como vocativo)
Cliente legado com `nome="5511949841973"` recebeu IA dizendo "Tô com dificuldade de ler sua receita aqui mesmo nas tentativas, 5511949841973". Causa: webhook antigo gravou telefone como nome; templates usavam `contatoNomeAtual.split(" ")[0]` direto. Correção: guardrail `nomeEhPlaceholder` zera vocativo + sequencial `Cliente #NNNN` para novos contatos.
