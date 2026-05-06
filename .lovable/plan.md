## Editar e excluir mensagens enviadas

Habilita o autor de uma mensagem a **editar** ou **excluir** o que enviou, em três escopos:

1. **Conversa com cliente** (CRM `/crm/conversas` → `mensagens`)
2. **Mensagens internas 1:1** (`/mensagens` → `mensagens_internas`)
3. **Demandas de loja** (thread interno → `demanda_mensagens`)

Permissão: **somente o autor** da mensagem. Admin não entra nessa entrega (pode entrar depois se necessário).

## Regras de produto

- **Janela de edição/exclusão**: 15 minutos após o envio. Depois disso, mensagem fica imutável (evita reescrever histórico de auditoria).
- **Editar**: substitui o conteúdo, marca `editada_at` e guarda o conteúdo anterior em `metadata.historico_edicoes[]`. UI mostra tag "(editada)" com tooltip do horário.
- **Excluir**: soft-delete. Marca `deletada_at` + `deletada_por`. UI renderiza "🚫 Mensagem apagada" no lugar do conteúdo. Não apaga o registro do banco (auditoria).
- **WhatsApp (cliente)**: a Meta **não permite apagar/editar** mensagem já entregue ao cliente via API. Então:
  - Edição/exclusão **só afeta o histórico interno** (CRM).
  - Aviso visual no menu: "Isso só corrige o registro interno. O cliente continua vendo a mensagem original no WhatsApp."
  - Para mensagens com `direcao='inbound'` (recebidas do cliente) → **bloqueado** (operador não edita o que o cliente disse).
- **Anexos**: excluir mensagem com imagem mantém o arquivo no Storage (não removemos para não quebrar links em outros lugares). Edição não permite trocar anexo, só legenda/texto.

## Mudanças no banco (1 migration)

Adicionar colunas em `mensagens`, `mensagens_internas` e `demanda_mensagens`:

- `editada_at timestamptz null`
- `deletada_at timestamptz null`
- `deletada_por uuid null`
- `metadata.historico_edicoes` (jsonb array já existente em `metadata` nas três tabelas — apenas convenção, sem schema novo)

Em `mensagens_internas`, adicionar policy de UPDATE para o autor:
```
CREATE POLICY "Authors can edit/delete own messages"
ON mensagens_internas FOR UPDATE TO authenticated
USING (remetente_id = auth.uid())
WITH CHECK (remetente_id = auth.uid());
```

`mensagens` e `demanda_mensagens` já têm policy `authenticated ALL` permissiva — não precisa mexer.

## UI — padrão único nos três componentes

Em cada bolha de mensagem **outbound/própria** dentro da janela de 15min, aparece um menu de 3 pontinhos (`MoreVertical`) ao passar o mouse, com:

- **Editar** — abre o conteúdo no textarea com botões "Salvar" / "Cancelar".
- **Excluir** — `AlertDialog` de confirmação ("Excluir esta mensagem? Em conversas com clientes, ele continuará vendo a original no WhatsApp.").

Renderização:
- `deletada_at != null` → bolha cinza claro com ícone 🚫 e texto "Mensagem apagada" (e quando for imagem, esconde a thumb).
- `editada_at != null` → texto + chip discreto "editada" com tooltip mostrando `editada_at`.

Arquivos tocados:
- `src/pages/Atendimentos.tsx` — bolhas WhatsApp (linhas ~430-460 da renderização). Bloqueia menu quando `direcao === 'inbound'` ou fora da janela.
- `src/pages/Mensagens.tsx` — bolhas do chat 1:1.
- `src/components/atendimentos/DemandaThreadView.tsx` — bolhas do thread de demanda.

Componente compartilhado novo: `src/components/shared/MessageActionsMenu.tsx` recebendo `{ messageId, autorId, createdAt, onEdit, onDelete, disabled }` para evitar duplicar a lógica de janela/owner nos três pontos.

Hooks novos em `src/hooks/useAtendimentos.ts`, `useMensagensInternas.ts` e `useDemandas.ts`:
- `useEditMensagem()` / `useDeleteMensagem()` — fazem UPDATE direto via supabase client (RLS já filtra por autor).
- Cada update preenche `metadata.historico_edicoes` com `[{ at, conteudo_anterior }]` antes de gravar o novo `conteudo`.

## Realtime

Os três componentes já assinam mudanças nas tabelas. Adicionar listener `UPDATE` (além do `INSERT` atual) para refletir edição/exclusão em todos os clientes abertos. Garante a regra de registrar `.on(...)` antes do `.subscribe()`.

## Fora de escopo

- Tentativa de delete via Meta WhatsApp API (não suportado em produção pela Cloud API).
- Edição/exclusão por admin de mensagens de outros usuários.
- Apagar arquivo do Storage ao excluir mensagem com anexo.
- Editar/excluir mensagens da IA ou geradas por automação (nenhum operador é autor → menu não aparece).

## Validação

1. Em `/crm/conversas`, enviar texto, editar dentro de 1min → bolha mostra "(editada)", outros operadores veem update via realtime.
2. Excluir após 5min → vira "🚫 Mensagem apagada".
3. Tentar editar após 16min → menu não aparece.
4. Mensagem `inbound` (cliente) → menu não aparece nunca.
5. Em `/mensagens`, usuário B tenta editar mensagem do usuário A → RLS rejeita (verificar no console).
6. Em demanda, excluir mensagem com anexo de imagem → texto somemenu  some, arquivo no Storage continua acessível por URL direta (esperado).