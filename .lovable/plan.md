# Refatorar Gestão de Usuários — modelo modular

## Diagnóstico

Hoje conflitam 4 conceitos sobrepostos: `profiles.tipo_usuario`, `profiles.cargo_loja`, `user_roles.role` e `profiles.lojas[]`. O formulário pede tudo isso de uma vez sem deixar claro o que é **identidade** (quem é a pessoa), o que é **acesso** (o que ela vê) e o que é **escopo** (sobre qual fatia da operação). Resultado: supervisor sem como cobrir grupo de lojas, diretor sem como abrir todos os menus de loja, "cargo" opcional sem efeito real.

## Modelo novo (3 perguntas, nessa ordem)

```text
1) IDENTIDADE      → Nome, e-mail, foto
2) ACESSO          → Quais MÓDULOS vê + quais PODERES tem em cada um
3) ESCOPO          → Sobre QUAIS lojas e QUAIS setores ele age
```

Cada usuário tem **N módulos** × **M lojas/setores**. Sem perfis travados. Sem `cargo_loja` opcional confuso.

### Módulos (checkboxes)

Atrium web: `dashboard`, `crm`, `lojas`, `financeiro`, `ti`, `interno`, `estoque`, `tarefas`, `mensagens`, `demandas`, `configuracoes`.
InFoco Messenger: `chat_1a1`, `chat_grupo`, `demandas_minhas_lojas`, `menu_loja` (os fluxos do bot).

Para cada módulo marcado, um seletor de **poder**: `ver` / `agir` / `encerrar`.

### Escopo

- **Lojas**: checklist multi (todas / seleção). Vazio = nenhuma.
- **Setores**: checklist multi. Vazio = nenhum.
- Atalho "Acesso total" marca todas as lojas + todos os setores + todos os módulos com poder `agir` (exceto Configurações, que continua restrita a Admin).

## Telas

**Diálogo de edição reorganizado em 3 abas:**

```text
┌─ Identidade ──┬─ Acesso ──┬─ Escopo ─┐
│ Nome          │ Módulos   │ Lojas    │
│ E-mail        │ + poder   │ Setores  │
│ Foto          │ por módulo│          │
└───────────────┴───────────┴──────────┘
```

**Tabela de usuários** ganha colunas: `Módulos` (chips), `Lojas` (N selecionadas / "todas"), `Setores` (N), com tooltip mostrando o detalhe.

**Atalhos rápidos** (botões no topo do diálogo) que pré-marcam o checklist — você ainda pode ajustar depois:
- Diretor → todos módulos (poder `agir`), todas lojas, todos setores, exceto Configurações
- Supervisor de lojas → módulos `lojas` + `demandas` + `mensagens` + `tarefas` (poder `agir`), você escolhe quais lojas
- Operador de loja → mesmos módulos, poder `ver`+`agir`, 1 loja
- Op. de setor → módulos do setor + `mensagens`, escopo = 1 setor
- Admin → tudo

Atalho é só preenchimento — não vira um "tipo" gravado.

## Banco

Nova tabela `user_acessos` (uma linha por usuário, JSON):

```text
user_acessos
├─ user_id (PK)
├─ modulos jsonb       — { "crm":"agir", "lojas":"ver", ... }
├─ lojas text[]        — nomes (vazio = nenhuma; null = todas)
├─ setores uuid[]      — ids (vazio = nenhum; null = todos)
├─ acesso_total bool   — flag para Diretor (bypassa filtros)
└─ updated_at
```

`profiles.tipo_usuario` permanece (define onde a pessoa vive: Atrium web vs Messenger), mas vira **derivado** automático:
- tem módulo `menu_loja`+escopo de loja sem nenhum módulo web → `loja`
- tem só módulos web → `colaborador` ou `setor_operador`
- `acesso_total=true` → `admin`

Trigger preenche `tipo_usuario` e mantém `user_roles` em sincronia para não quebrar o resto do app.

`cargo_loja` é **descontinuado** (mantém coluna por compatibilidade, deixa de ser editável). `profiles.lojas` e `lojas_responsaveis` (criado na conversa anterior) se fundem em `user_acessos.lojas` — uma fonte só.

## Impacto no resto

- `ProtectedRoute` / `AppLayout` passam a ler `user_acessos.modulos` em vez de inferir por `setores`/`role`.
- Watchdog T+30/T+60: passa a buscar destinatários por `user_acessos.lojas` (mesma fonte que o operador de T+15), sem precisar dos campos paralelos.
- `pode_conversar_1a1` continua valendo (loja↔setor proibido em chat livre), mas o "Diretor" entra como exceção via `acesso_total`.
- InFoco Messenger lê `user_acessos.modulos` para decidir se mostra "Demandas das minhas lojas" e o menu de loja.

## Migração de dados

Script de mutirão único que lê cada `profile` atual e popula `user_acessos`:
- `admin` → acesso_total
- `setor_operador` → módulos do setor + mensagens, escopo = setor atual
- `loja` + `cargo_loja=operador` → módulos lojas/mensagens/tarefas, 1 loja
- `loja` + `cargo_loja in (supervisor,gerente)` → mesmos módulos, lojas = `profiles.lojas ∪ lojas_responsaveis`
- `colaborador` → conforme `user_roles` atuais

Você revisa caso a caso na nova UI depois.

## Entregáveis

1. Migration: tabela `user_acessos`, trigger de sync com `profiles.tipo_usuario`+`user_roles`, RLS (admin lê/escreve tudo; cada um lê o próprio).
2. Script de migração de dados (1 vez, idempotente).
3. Refator `GestaoUsuariosCard.tsx`: diálogo em 3 abas, tabela com colunas novas, atalhos de perfil.
4. `useAuth` expõe `acessos: { modulos, lojas, setores, acessoTotal }`.
5. `ProtectedRoute` + `AppLayout` consomem `acessos.modulos` para liberar rotas.
6. Edge function `watchdog-demandas-loja` lê `user_acessos.lojas` para escalar T+30/T+60.
7. Instruções para colar no InFoco Messenger (leitura de `user_acessos` no app).

## Fora deste plano

- Não mexo em IA, pipelines, automações, WhatsApp.
- Configurações continua exclusiva de Admin (mesmo Diretor não entra) — se você quiser mudar, é 1 linha depois.
