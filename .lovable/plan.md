## Objetivo

Tornar inequívoco no editor de usuário que **Lojas** e **Setores** são dois escopos alternativos (não complementares), e impedir que alguém marque o setor legado "Loja" pensando que precisa duplicar a vinculação.

## O que muda na tela `AcessosEditorDialog.tsx` (aba Escopo)

### 1. Cabeçalho explicativo no topo da aba Escopo

Adicionar um bloco informativo curto antes dos dois campos:

> **Escolha um dos dois escopos abaixo, não os dois.**  
> • **Lojas** — se a pessoa trabalha *para* uma unidade física (operador de loja, supervisor regional). Ela vai receber agendamentos, demandas e push da(s) loja(s) marcada(s).  
> • **Setores** — se a pessoa trabalha *para* uma fila interna por especialidade (Financeiro, TI, Comercial, Estoque). Ela vai receber as demandas roteadas para esse setor.  
> A maioria dos usuários marca **só um lado**.

### 2. Travas visuais (sem bloquear o save)

- Quando o usuário começa a marcar lojas, exibir um aviso amarelo discreto na seção Setores: "Você já definiu escopo por loja — normalmente não precisa marcar setores aqui."
- Quando marca setores, espelhar o aviso no bloco Lojas.
- Os campos continuam editáveis (para casos híbridos raros como diretor regional), só ganham o aviso.

### 3. Esconder o setor legado "Loja" da lista de setores selecionáveis

O setor `277307f3-…` chamado **"Loja"** não deve aparecer no checklist de Setores do editor. Ele é semanticamente o mesmo que "marcar uma loja em Lojas" e só causa erro humano. Filtro client-side por nome (`nome ILIKE 'loja'`) na query `editor-setores-disponiveis`.

(Não removemos do banco — outras partes do sistema podem ainda referenciar. Só sumimos da UI de edição.)

### 4. Resumo no chip da aba

O badge da aba Escopo hoje diz `"1 loja(s) / 0 setor(es)"`. Trocar para algo legível:
- só lojas marcadas → `"Loja: DINIZ SUPER SHOPPING"`
- só setores → `"Setor: Financeiro"`
- ambos → `"1 loja + 1 setor"` (com warning)
- nenhum (e não é acesso total) → `"⚠ sem escopo"` em vermelho.

### 5. Ajuste no atalho "Operador de loja" em `src/lib/acessos.ts`

O perfil rápido `operador_loja` hoje só preenche módulos. Acrescentar no `apply()`:
```ts
setores: [],          // explicitamente vazio
todosSetores: false,
```
para que quem clica no atalho já saia com setores zerados e não fique tentado a marcar "Loja".

Idem para `supervisor` (setores vazio) e `setor` (lojas vazio).

## O que NÃO muda

- Schema do banco: nada. `user_acessos.lojas` e `user_acessos.setores` continuam como hoje, o trigger `sync_from_user_acessos` continua derivando `user_roles` corretamente quando os dois campos são usados de forma mutuamente exclusiva.
- Edge function `admin-create-user`: nenhuma alteração.
- Para o usuário diniz.super especificamente: o reparo pontual (limpar `setores`, deixar só `lojas=['DINIZ SUPER SHOPPING']`) continua sendo necessário e segue na próxima etapa, em paralelo a este plano de UI.

## Arquivos afetados

- `src/components/configuracoes/AcessosEditorDialog.tsx` — aba Escopo, query de setores, badge da aba.
- `src/lib/acessos.ts` — `apply()` dos perfis rápidos `operador_loja`, `supervisor`, `setor`.

## Critério de aceite

- Ao abrir um operador de loja, fica óbvio na tela que ele deve marcar **só** a loja, sem nada em Setores.
- O setor "Loja" não aparece mais no checklist.
- Atalho "Operador de loja" já deixa Setores vazio.
- Salvar sem nenhum escopo e sem acesso total mostra aviso visível antes do submit.
