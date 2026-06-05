# Continência de notificações configurável por Admin

Hoje `resolver_destinatarios_atendimento` cai num fallback "todos admin/colaborador ativos" quando o atendimento não tem atendente nem `setor_id` na coluna — por isso `natanborges@icloud.com` recebe push de conversas que não atende. A correção é deixar o **admin** decidir quem recebe, sem dar essa alavanca ao próprio usuário.

## Escopo

1. **Apenas admins** configuram (RLS `has_role(auth.uid(),'admin')` ou `pode_gerenciar_usuarios`).
2. Configuração existe em dois níveis, ambos no mesmo painel:
   - **Por usuário** — liga/desliga recebimento dos tipos `atendimento_inbound`, `atendimento_humano`, `demanda_loja`, `mensagem_interna`; e opcionalmente restringe a um conjunto de setores.
   - **Fallback global** — quando o atendimento cai no nível 3 (sem atendente, sem setor na coluna), define **qual setor / quais usuários** recebem. Default: ninguém (vira tarefa do supervisor reatribuir).

## Entregáveis

### Banco
Tabela nova `public.notificacao_preferencias`:
- `user_id` (FK profiles, único por tipo)
- `tipo` text (`atendimento_inbound` | `atendimento_humano` | `demanda_loja` | `mensagem_interna` | `*`)
- `escopo` enum `nenhum` | `meus_setores` | `setores_especificos` | `todos`
- `setor_ids uuid[]`
- `ativo bool default true`
- `updated_by uuid` (quem alterou — admin)

RLS: SELECT/INSERT/UPDATE/DELETE só para `has_role(auth.uid(),'admin')` (admin lê e escreve a preferência de qualquer usuário). Usuário não-admin **não vê** essa tabela. `service_role` ALL.

Config global em `configuracoes_ia`:
- `chave='fallback_destinatarios_atendimento'`, `valor` JSON `{ "setor_id": "uuid|null", "user_ids": ["uuid"], "incluir_admins": false }`.

### Função `resolver_destinatarios_atendimento`
- Mantém ordem atual (atendente → setor da coluna → fallback).
- **Filtro novo** aplicado sobre o conjunto resolvido: remove user cuja preferência diz `escopo='nenhum'` para o tipo; mantém só os do escopo configurado (`meus_setores` / `setores_especificos`). Usuário sem registro = comportamento atual (recebe). Tipo é passado como novo parâmetro `_tipo text` (overload), com default `'atendimento_inbound'`.
- **Nível 3 passa a ler** `fallback_destinatarios_atendimento` em vez de "todos admin/colaborador". Default vazio → ninguém é notificado (evita ruído).
- Triggers `trg_push_inbound_humano` e `trg_atendimento_modo_humano` passam o `tipo` correto ao chamar a função.

### UI — Configurações → Usuários
- No `GestaoUsuariosCard`, nova coluna "Notificações" com badge resumindo (`Todas` / `Meus setores` / `2 setores` / `Nenhuma`).
- Botão lápis abre dialog `NotificacaoPrefsDialog` (só renderiza se `isAdmin`): grid tipos × escopo, multiselect de setores. Persiste em `notificacao_preferencias` registrando `updated_by = auth.uid()`.
- Card novo **Plantão / Fallback de notificações** na aba Usuários: select de setor + multiselect de usuários extras + switch "Incluir admins". Grava `configuracoes_ia.fallback_destinatarios_atendimento`.
- **Usuário não-admin não tem UI alguma** para mudar isso — nem no perfil dele, nem em outro card. Fica oculto.

### Backfill imediato
Insert `notificacao_preferencias` `escopo='nenhum'` tipo `atendimento_inbound` e `atendimento_humano` para `420c274c-4d4a-4b22-9a22-f29d117c3c72` (Natan). Em paralelo, gravar fallback global vazio para parar o vazamento antes do admin escolher destino.

### Memória
- Atualizar `mem://atendimento/push-operador-humano` descrevendo os 3 níveis + filtro de preferências + fallback configurável.
- Nova `mem://configuracoes/notificacoes-admin-only` lembrando que somente admin configura e que o nível 3 default é "ninguém".

## Fora do escopo
- Não criar UI de preferências para o próprio usuário.
- Não mexer no Messenger / mensagens_internas agora.
- Não adicionar janela "Não perturbe" / horário — fica como evolução reusando a mesma tabela.

## Arquivos afetados
- Migração nova (tabela + função + grants + RLS).
- `src/components/configuracoes/GestaoUsuariosCard.tsx` (coluna + botão).
- Novo `src/components/configuracoes/NotificacaoPrefsDialog.tsx`.
- Novo `src/components/configuracoes/FallbackNotificacoesCard.tsx` (montado em `Configuracoes.tsx` aba `usuarios`).
- Memórias citadas.

## Validação
- Logar como admin → ver/editar preferências de outro usuário; logar como não-admin → coluna nem botão aparecem.
- Inserir mensagem inbound em atendimento sem atendente nem setor → ninguém é notificado (fallback vazio).
- Configurar fallback para setor "Atendimento Corporativo" → apenas membros recebem.
- Para Natan: nenhum push após backfill, mesmo se admin no banco.
