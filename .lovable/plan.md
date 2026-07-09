## Diagnóstico

Duas peças ficaram faltando na entrega do diálogo setor↔loja:

1. **Notificação não é clicável.** `TopNavigation.handleNotifClick` só navega quando `notif.tipo === "solicitacao"`. As notificações criadas por `comentar-solicitacao` chegam com `tipo` = `retorno_setor` / `resposta_loja`, então o clique não faz nada.
2. **UI do setor não expõe a thread.** O setor Financeiro opera no kanban `/financeiro` (`PipelineFinanceiro.tsx`) e abre um `Dialog` genérico do card (linha 607+). Esse dialog **não** renderiza `useSolicitacaoComentarios` nem tem o campo "Comentar com a loja". A tela `src/pages/Solicitacoes.tsx` — onde a thread e o campo já existem — **não está registrada em `App.tsx`**, ou seja, ninguém acessa. Além disso, mesmo se acessasse, ela não lê query param para abrir o item vindo da notificação.

Resultado: o setor recebe a notificação, mas não tem como ler nem responder.

## Plano

### 1. Deep-link da notificação (setor e loja)
Ajustar `handleNotifClick` em `src/components/layout/TopNavigation.tsx` para:
- Reconhecer `tipo ∈ {solicitacao, retorno_setor, resposta_loja}`.
- Navegar para `/financeiro?sol=<referencia_id>` (setor). Para loja/Messenger não muda nada aqui — a app Messenger tem o próprio handler.

### 2. Abrir o card automaticamente ao chegar via link
Em `PipelineFinanceiro.tsx`:
- Ler `?sol=<id>` com `useSearchParams`.
- Quando a lista de solicitações carregar, achar a solicitação pelo id e chamar `setSelectedSolicitacao(sol)` (uma vez, com guarda).
- Limpar o query param após abrir.

### 3. Thread de comentários dentro do drawer do card
No `Dialog` genérico (linha 607+) do `PipelineFinanceiro.tsx`, adicionar uma seção "Diálogo com a loja":
- Render de `useSolicitacaoComentarios(selectedSolicitacao.id)` com badges "Setor" / "Loja" / "Interno" — mesmo visual que já existe em `Solicitacoes.tsx` (reaproveitar componente).
- Campo `Textarea` + botão **"Enviar observação para a loja"** que chama `useCreateComentario` com `tipo: "retorno_setor"` (invoca `comentar-solicitacao`).
- Não muda status, não move o card.
- Aparece apenas quando o contato da solicitação é `loja` / `colaborador` (mesma regra do `pipeline-automations`).

Para evitar duplicar JSX, extrair um pequeno componente `SolicitacaoThreadPanel` em `src/components/financeiro/SolicitacaoThreadPanel.tsx` reutilizado tanto pelo `PipelineFinanceiro` quanto pelo `Solicitacoes.tsx` já existente.

### 4. Realtime opcional (rápido)
Assinar `postgres_changes` em `solicitacao_comentarios` filtrando por `solicitacao_id` para o painel atualizar sozinho quando a loja responder, sem depender de refetch por foco.

### 5. Espelho na app da loja (fora deste repo)
Esta parte já foi entregue no backend (edge function + `resposta_loja` no hook). A UI da loja (projeto Messenger) precisa:
- No clique da notificação `resposta_loja`/`retorno_setor`, abrir o detalhe da solicitação.
- Renderizar `solicitacao_comentarios` como thread e permitir enviar `tipo: "resposta_loja"` via `comentar-solicitacao` (já está no hook compartilhado).

Deixo isso listado aqui para ser feito no repo do Messenger — não faz parte deste patch.

## Fora do escopo
- Anexos no comentário.
- Marcar comentário como resolvido.
- Rota dedicada `/solicitacoes` — o setor continua operando pelo kanban `/financeiro`; a página `Solicitacoes.tsx` fica como fallback administrativo (podemos registrá-la depois se quiser).

## Detalhes técnicos
- Arquivos alterados: `src/components/layout/TopNavigation.tsx`, `src/pages/PipelineFinanceiro.tsx`, novo `src/components/financeiro/SolicitacaoThreadPanel.tsx`, refactor leve em `src/pages/Solicitacoes.tsx` para usar o mesmo componente.
- Sem migração de schema. Sem mudança em edge functions (a `comentar-solicitacao` já está no ar).
- Notificação já traz `referencia_id = solicitacao_id`; nada muda no backend.
