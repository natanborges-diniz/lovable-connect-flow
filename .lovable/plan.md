## Objetivo

Tornar o cadastro de usuários "loja" intuitivo:
- 1 usuário, 1 tela: tipo, **cargo**, lojas (múltiplas), setor.
- Usuários "loja" só conseguem usar o **InFoco Messenger** (Atrium web bloqueado).
- O **menu de demandas** do Messenger varia por cargo: supervisor vê tudo; gerente vê quase tudo; operador não vê itens sensíveis (ex.: pedir reembolso).

Exemplo final que vai funcionar: cadastrar Josivaldo → tipo `loja`, cargo `supervisor`, lojas `[Carapicuíba, Barueri]` → marcando uma única vez.

---

## 1. Banco de dados

**`profiles`**
- Adicionar coluna `cargo_loja text` com check `('supervisor','gerente','operador')`. Nullable (só usado se `tipo_usuario='loja'`).
- Adicionar coluna `lojas text[] DEFAULT '{}'` (lojas que o usuário cobre, fonte da verdade para "loja"). O campo `loja_nome` em `user_roles` continua existindo como espelho para RLS de pipeline.

**`bot_menu_opcoes`**
- Adicionar coluna `cargos_visiveis text[] DEFAULT '{supervisor,gerente,operador}'`. Quando vazio, vale para todos.

**Trigger `sync_user_roles_from_profile()`**
- Disparado em `AFTER UPDATE/INSERT` em `profiles` quando `lojas` ou `tipo_usuario` mudam.
- Reescreve `user_roles` do usuário: 1 linha `setor_usuario` por loja em `profiles.lojas`, com `loja_nome` preenchido. Garante consistência sem o admin precisar editar nada manualmente.

---

## 2. Edge function `bot-lojas`

Hoje monta o menu lendo `bot_menu_opcoes` filtrando por `tipo_bot` e `parent_id`. Vai passar a também filtrar por `cargos_visiveis`:
- Identifica o cargo do solicitante via telefone → `profiles.cargo_loja`.
- Se cargo encontrado, filtra opções cujo `cargos_visiveis` contém aquele cargo (ou está vazio).
- Se cargo não encontrado, cai no comportamento atual (mostra tudo).

---

## 3. Bloqueio do Atrium web para tipo=loja

Em `src/components/auth/ProtectedRoute.tsx` e `AppLayout.tsx`:
- Se `profile.tipo_usuario === 'loja'`, redirecionar para uma página simples `/somente-messenger` com botão "Abrir InFoco Messenger" (link para `desktop-joy-app.lovable.app`) e logout.
- Login pelo Atrium continua possível (precisa, para gerar magic link), mas qualquer rota interna fica fechada.

---

## 4. Tela "Gestão de Usuários" — redesenho

Substituir a UX atual (Tipo + Nível + Áreas em colunas confusas) por **um formulário único** ao clicar em "Editar":

```text
┌─ Editar usuário ────────────────────────────────┐
│ Nome:   Josivaldo                               │
│ E-mail: josivaldo@…                             │
│                                                 │
│ Tipo:   ( ) Admin                               │
│         ( ) Operador de Setor                   │
│         (•) Loja                                │
│         ( ) Colaborador                         │
│                                                 │
│ ── quando Tipo = Loja ─────────────────────     │
│ Cargo:  (•) Supervisor                          │
│         ( ) Gerente                             │
│         ( ) Operador                            │
│                                                 │
│ Lojas:  [x] Carapicuíba   [x] Barueri           │
│         [ ] Osasco        [ ] Tatuapé   …       │
│                                                 │
│ ── quando Tipo = Operador de Setor ────────     │
│ Setor:  [ Financeiro ▾ ]                        │
│                                                 │
│ Acesso ao Atrium web: 🚫 (somente Messenger)    │
│                                                 │
│ [Cancelar]                       [Salvar]       │
└─────────────────────────────────────────────────┘
```

Lista principal vira uma tabela enxuta: **Nome · E-mail · Tipo · Cargo/Setor · Lojas/Áreas · Ativo · Ações**.

Salvar grava `profiles` (tipo_usuario, cargo_loja, lojas, setor_id) — o trigger sincroniza `user_roles` sozinho.

---

## 5. Tela "Bot Menu" (Configurações)

Em cada linha do `BotMenuCard`, adicionar um campo de chips **"Visível para cargos"** (`supervisor`, `gerente`, `operador`). Ao deixar tudo desmarcado: mostra para todos. Para a opção "Pedir reembolso", o admin desmarca `operador` e pronto.

---

## 6. Memória / docs

Atualizar `mem://arquitetura/tipos-usuario-app-interno` com `cargo_loja` + `lojas[]` + filtro de menu por cargo, e adicionar uma core rule curta no índice.

---

## Fora do escopo

- Não mexe no fluxo de WhatsApp Meta nem no Gael.
- Não muda quem pode iniciar 1:1 (RLS `pode_conversar_1a1` continua).
- Wizard de cadastro em lote será atualizado em uma segunda etapa para preencher `cargo_loja` e `lojas[]` (por enquanto continua funcional, só não preenche cargo).