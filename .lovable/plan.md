

# Reestruturação do Menu do Bot com Sub-Menus por Setor + "Falar com Equipe"

## Problema Atual

O menu do bot para lojas/departamentos tem **13 opções em lista plana** — difícil de navegar. O pipeline "Atendimento Gael" é redundante, pois o bot já roteia automaticamente.

## Nova Estrutura do Menu (3 níveis)

```text
Menu Principal:
  1️⃣ 💰 Financeiro
  2️⃣ 🖥️ TI
  3️⃣ 📋 Operacional

→ Financeiro:
  1️⃣ 💳 Cobranças (Link Pagamento, Boleto, Consulta CPF)
  2️⃣ ↩️ Estornos e Devoluções (Estorno PIX, Estorno Cartão, Devolução OS)
  3️⃣ ✅ Confirmações (Confirmação PIX)
  4️⃣ 💵 Pagamentos (Reembolso, Pagamento Fornecedor)
  5️⃣ 💬 Falar com a equipe

→ TI:
  1️⃣ 🔧 Suporte Técnico
  2️⃣ 🖨️ Impressões
  3️⃣ 🔐 Autorização Dataweb
  4️⃣ 💬 Falar com a equipe

→ Operacional:
  1️⃣ 📋 Confirmar Comparecimento
  2️⃣ 💬 Falar com a equipe

→ Cobranças (sub-menu):
  1️⃣ 🔗 Link de Pagamento
  2️⃣ 📄 Boleto
  3️⃣ 🔍 Consultar CPF
```

## Mudanças Técnicas

### 1. Migração SQL

- Adicionar coluna `parent_id uuid REFERENCES bot_menu_opcoes(id)` na tabela `bot_menu_opcoes`
- Adicionar coluna `tipo text DEFAULT 'fluxo'` (valores: `submenu`, `fluxo`, `falar_equipe`)
- Desativar setor "Atendimento Gael" e suas colunas (`pipeline_colunas WHERE setor_id = '32cbd99c-...'`)
- Inserir novas opções de menu hierárquicas (setores → categorias → fluxos) e opções "Falar com equipe"

### 2. `supabase/functions/bot-lojas/index.ts`

- **`loadMenuOpcoes`**: Aceitar `parent_id` como filtro. Menu raiz = `parent_id IS NULL`
- **`buildMenuDynamic`**: Adicionar botão "⬅️ Voltar" quando `parent_id` não é nulo
- **Navegação no `menu_principal`**: Quando o usuário seleciona um item do tipo `submenu`, carregar os filhos e exibir o sub-menu (sem iniciar fluxo). Guardar na sessão o `parent_id` para suportar "voltar"
- **Tipo `falar_equipe`**: Ao selecionar, criar uma notificação interna no setor correspondente via `mensagens_internas` + `notificacoes`, informar ao usuário que a equipe foi acionada

### 3. `src/components/configuracoes/BotMenuCard.tsx`

- Exibir hierarquia na tabela (indentação ou agrupamento por pai)
- Formulário de criação: campo "Pai" (select com opções tipo `submenu`) e campo "Tipo" (submenu/fluxo/falar_equipe)

### 4. Dados do Menu (via insert tool)

Reorganizar as 13 opções existentes como filhas dos novos sub-menus, criando a árvore descrita acima.

## "Falar com Equipe" — Comportamento

1. Bot envia: "✅ Equipe do Financeiro acionada! Um colaborador entrará em contato em breve."
2. Cria `notificacao` para o `setor_id` correspondente com `tipo = 'falar_equipe'`
3. O operador do setor vê a notificação in-app e responde via comentários da solicitação ou mensageria interna
4. Sessão do bot volta ao menu principal

## Resultado

- Menu limpo com 3 opções no nível raiz em vez de 13
- Navegação intuitiva por setor → categoria → ação
- "Falar com equipe" disponível em cada setor
- Pipeline "Atendimento Gael" desativado (demandas genéricas resolvidas via "Falar com equipe")

