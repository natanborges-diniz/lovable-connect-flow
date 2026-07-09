## Diagnóstico

Confirmado no banco: `SOL-2026-00115` e `SOL-2026-00117` estão `status='concluida'` (não arquivadas), sentadas na coluna terminal "Concluídas" do Financeiro. Estão no kanban, mas invisíveis à primeira vista por três razões:

1. **Protocolo não aparece no rosto do card.** O `CardContent` (linha 416) mostra loja, ícone do tipo, `assunto` e nome do contato — mas nunca renderiza `sol.protocolo`. O único lugar que exibe o código é o título do modal de edição (linha 1077, admin). Sem o `SOL-YYYY-NNNNN` na frente, o operador não bate o olho na notificação e localiza o card.
2. **Deep-link falha silenciosamente.** O `useEffect` do `/financeiro?sol=<id>` procura o card **apenas** na lista já filtrada. Se estiver em coluna oculta, filtrado por busca, ou (no futuro) arquivado, `found` é `undefined` e o dialog nunca abre — sem toast, sem log visível.
3. **Dialog do card não rola.** O `DialogContent` do drawer não tem `max-h` nem `overflow`, então o painel de diálogo com a loja fica abaixo da dobra em telas menores — "corta logo acima da caixa de diálogo".
4. **Gate do painel de thread muito restritivo.** `SolicitacaoThreadPanel` só renderiza quando `contato.tipo ∈ {loja, colaborador}`. Solicitações abertas em nome do cliente final mas com vínculo em `metadata.alias_loja`/`loja_nome` (o caso das duas SOLs) escondem a thread inteira.

## Plano

### 1. Protocolo visível no card (`PipelineFinanceiro.tsx`, ~L425)
Adicionar linha compacta no topo do `min-w-0 flex-1`, antes da loja:
```
<span className="font-mono text-[10px] text-muted-foreground">{sol.protocolo}</span>
```
Mantém a hierarquia visual (loja em destaque, assunto principal) mas dá ao operador o código para casar com a notificação.

### 2. Deep-link resiliente (`PipelineFinanceiro.tsx`)
- Se `?sol=<id>` chegar e o card não estiver na lista renderizada, buscar direto:
  `supabase.from("solicitacoes").select("*, contato:contatos(id,nome,telefone,tipo)").eq("id", id).single()`.
- Popular `selectedSolicitacao` com o resultado — abre o drawer mesmo se o card estiver em coluna oculta/arquivada.
- Erro → `toast.error("Solicitação não encontrada")` e limpa `?sol`.
- Se vier arquivada, exibir badge "Arquivado" no header do drawer.

### 3. Dialog rolável (`PipelineFinanceiro.tsx`)
- `max-h-[90vh] overflow-y-auto` no `DialogContent` do card.
- `<DialogDescription className="sr-only">…</DialogDescription>` para calar o warning de a11y.

### 4. Painel de thread com regra correta (`PipelineFinanceiro.tsx`)
Renderizar `SolicitacaoThreadPanel` quando **qualquer**:
- `contato.tipo` for `loja`/`colaborador`;
- `metadata.alias_loja` ou `metadata.loja_nome` preenchidos;
- já existir comentário `retorno_setor`/`resposta_loja` (checagem interna).

### 5. Highlight opcional
Ring animado ~2s no card quando aberto via `?sol=<id>` e presente no kanban — para o operador achar a origem visual, útil em "Concluídas" que exige rolagem.

## Detalhes técnicos
- Arquivos: `src/pages/PipelineFinanceiro.tsx`, `src/components/financeiro/SolicitacaoThreadPanel.tsx`.
- Sem migração, sem edge function.

## Fora do escopo
- Rota `/solicitacoes/:id`.
- Espelho no Messenger da loja.
