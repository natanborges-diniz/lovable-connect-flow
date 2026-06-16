---
name: Insert client-side em notificacoes
description: RLS de notificacoes exige .select() em todo insert do navegador; devolução à loja deve usar devolver-solicitacao-loja, não update direto
type: preference
---
## Regras

1. **Todo `supabase.from("notificacoes").insert(...)` no client DEVE encadear `.select()`** e tratar `error` com `toast.error`. Sem isso, o erro de RLS some silenciosamente. Mesma regra para `solicitacao_comentarios` em fluxos de retorno ao cliente/loja.

2. **Policy atual de `notificacoes`**: `authenticated` pode INSERT quando `usuario_id IS NOT NULL OR setor_id IS NOT NULL`. Inserts sem destinatário são bloqueados.

3. **Devolução à loja (Financeiro e demais setores)** deve sempre passar pela edge function `devolver-solicitacao-loja`, que:
   - cria/atualiza `demanda_loja` com `status=aguardando_complemento`
   - move o card para a coluna destino
   - notifica usuários da loja (sino + push via trigger)
   - habilita reabertura automática via `trg_demanda_resposta_reentrada` quando a loja responde no Atrium
   
   **Nunca** fazer apenas `update` direto em `solicitacoes` (foi o bug do branch "Dados Incompletos" do CpfApprovalDialog — a loja não tinha canal para responder e o card não reabria sozinho).

4. **Coluna `reentrada_revisao`** é obrigatória por setor para que o trigger consiga reabrir o card. Setor Financeiro: coluna "Revisão Pós-Loja" (`tipo_acao=reentrada_revisao`, ordem 19).

5. **Notificações terminais (Aprovar/Reprovar/Confirmar/etc.)** devem inserir notificação explícita via `resolver_destinatarios_loja` + linha em `notificacoes` — não confiar apenas na automação de coluna do `pipeline-automations`.
