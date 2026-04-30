---
name: Retorno do Setor via App (read-only para a loja)
description: Pipeline-automations envia retorno do setor (Aprovado/Reprovado/Dados Incompletos etc.) por solicitacao_comentarios+notificacoes quando contato é loja/colaborador, em vez de WhatsApp
type: feature
---
- `pipeline-automations` detecta `contato.tipo in ('loja','colaborador')` e roteia automaticamente `enviar_template`/`enviar_mensagem` para `notificarLojaApp()` em vez de WhatsApp.
- `notificarLojaApp` cria 1 `solicitacao_comentarios` com `tipo='retorno_setor'` (autor "Financeiro"/"Setor", visível na demanda da loja) e 1 `notificacoes` por usuário da loja resolvido via `resolver_destinatarios_loja(loja_nome)` — push automático via `trg_push_nova_notificacao`.
- Fonte do `loja_nome`: `solicitacao.metadata.alias_loja` (preenchido por `criar-solicitacao-loja`) → fallback `metadata.loja_nome` → `contato.metadata.loja_nome` → `contato.nome`.
- Variáveis de template suportadas: `{{nome_cliente}}`, `{{cpf}}`, `{{valor_*}}`, `{{dados_faltantes}}`, `{{observacao}}`.
- Consulta CPF — Dados Incompletos: UI exige campo "Observação para a loja" (`metadata.observacao_dados_incompletos`) antes de mover o card.
- Para tornar a thread "read-only" do lado da loja, basta a UI da loja ler `solicitacao_comentarios.tipo` e desabilitar resposta para `retorno_setor` (exposição já ocorre via `Solicitacoes.tsx`/`useSolicitacaoComentarios`).
- Padrão genérico: qualquer automação `enviar_template`/`enviar_mensagem` em coluna cujo card é uma `solicitacao` de contato interno passa por este mesmo trilho — não precisa criar regra dedicada.
