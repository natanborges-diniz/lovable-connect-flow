## Problema

Hoje o setor Financeiro só tem duas ações estruturadas numa solicitação da loja: **concluir** (com ou sem anexo) ou **pedir revisão/rejeitar**. Não existe um caminho para o setor apenas *comentar* algo do tipo *"vamos processar amanhã"* sem mudar o status — e a loja também não tem como responder a esse comentário. O que aparece hoje na thread da loja (`solicitacao_comentarios` com `tipo='retorno_setor'`) é criado só automaticamente pelo `pipeline-automations` a partir de templates WhatsApp; não há botão manual.

## Proposta: diálogo livre setor ↔ loja dentro da solicitação

Reaproveitar o que já existe (`solicitacao_comentarios` + `notificacoes` + push) e habilitar troca manual de mensagens dentro da própria demanda, sem alterar o status do card.

### 1. Setor → Loja (novo)
No drawer/detalhe da solicitação (Financeiro), adicionar campo "Comentar com a loja" + botão **Enviar observação**. Cria:
- `solicitacao_comentarios` com `tipo='retorno_setor'`, autor = operador logado.
- 1 `notificacoes` por usuário da loja (via `resolver_destinatarios_loja`) — push automático já dispara.
- Não muda status, não move card.

### 2. Loja → Setor (novo, opcional na mesma entrega)
Na tela da loja onde ela vê a solicitação (Messenger — `Solicitacoes`/thread), permitir **responder** ao comentário. Cria:
- `solicitacao_comentarios` com novo `tipo='resposta_loja'`, autor = usuário loja.
- 1 `notificacoes` para o operador responsável pela solicitação (ou fallback: todos com acesso à fila do setor).

### 3. Thread unificada
A lista de comentários (ordenada por `created_at`) fica visível dos dois lados, mostrando autor + horário + tipo (badge "Setor Financeiro" / "Loja X"). Nada de WhatsApp — 100% dentro do app (respeitando o Canal Único).

## Detalhes técnicos

- **Backend:** nova Edge Function `comentar-solicitacao` (setor→loja e loja→setor), que insere `solicitacao_comentarios` e cria as `notificacoes`. Mantém `pipeline-automations` como está para os retornos automáticos.
- **RLS:** garantir que loja consegue INSERT em `solicitacao_comentarios` da própria solicitação (hoje é read-only para loja). Ajuste em policy.
- **UI Atrium (setor):** `src/pages/Solicitacoes.tsx` (drawer) — textarea + botão + render da thread.
- **UI Messenger (loja):** tela de detalhe da solicitação — mesma thread + campo de resposta. (Ajuste no projeto Messenger.)
- **Sem migração de schema nova** — `tipo` é texto livre; só adicionamos os valores `resposta_loja` (e mantemos `retorno_setor`).

## Fora do escopo

- Anexos no comentário (fica para depois se pedirem).
- Marcar comentário como "resolvido".
- Notificar por WhatsApp — proibido pelo Canal Único para B2B.

## Pergunta antes de implementar

Confirma que quer **os dois sentidos** (setor→loja **e** loja→setor) na mesma entrega, ou prefere começar só com setor→loja para destravar o caso do Financeiro agora?
