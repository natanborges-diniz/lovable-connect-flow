## 1. Como o bot do Messenger funciona hoje

A engine vive em `bot-lojas/index.ts`, alimentada por duas tabelas configuráveis:

- **`bot_fluxos`** — 14 fluxos cadastrados, cada um com um `tipo_bot` e um `setor_destino_id`. Hoje: 13 com `tipo_bot='loja'` + 1 (`compra_funcionario`) com `tipo_bot='colaborador'`.
- **`bot_menu_opcoes`** — opções que aparecem no menu, filtradas por `tipo_bot` + `parent_id` (para submenus).

A engine resolve o `tipo_bot` em uma única linha (`bot-lojas/index.ts:464`):
```ts
const tipoBot = loja_info?.tipo_bot || "loja";
```

`loja_info` vem de `telefones_lojas` matching pelo telefone do remetente. Ou seja: **o menu disponível depende exclusivamente do registro em `telefones_lojas`**, e os `tipo_bot` possíveis são `loja`, `colaborador`, `departamento`.

### Inventário atual do menu

| `tipo_bot` | Usado por | Conteúdo |
|---|---|---|
| `loja` | Telefones de lojas físicas (operadoras de balcão) | 13 fluxos diretos: gerar boleto, link de pagamento, estornos, devoluções, autorização Dataweb, suporte TI, impressão, confirmar comparecimento etc. |
| `colaborador` | Telefones de funcionários individuais | 2 fluxos: Compra de Funcionário, Suporte Técnico |
| `departamento` | Telefones de "departamentos" / pessoas-chave | Menu **hierárquico** com 3 submenus (Financeiro, TI, Operacional), cada submenu com seus próprios subfluxos. É o menu mais completo. |

### O problema real

Não existe ainda o conceito de **supervisor** ou **diretor** no bot. Um supervisor que use o WhatsApp/Messenger é tratado como `loja` ou `colaborador` (depende de como foi cadastrado em `telefones_lojas`). Resultado:

- Supervisor de loja só vê o menu mínimo da loja (mesmo subset de uma operadora de balcão).
- Diretor vê só o que estiver no `tipo_bot` do telefone dele.
- Não há jeito de dar a um supervisor acesso ao **menu de departamento** (que é o mais completo) sem trocar o `tipo_bot` do registro inteiro.

---

## 2. Como vamos resolver

A proposta é tratar **hierarquia** como uma dimensão própria do bot, igual à hierarquia que vamos criar no app web. Em vez de duplicar fluxos por papel, **somamos** opções por papel.

### 2.1 Novos `tipo_bot`

Adicionar dois novos valores ao catálogo `bot_menu_opcoes.tipo_bot` / `bot_fluxos.tipo_bot`:

- `supervisor` — supervisor de uma ou mais lojas. Vê o menu de `loja` **mais** opções de gestão (relatórios, autorizações, estornos sem aprovação, etc.).
- `diretor` — diretoria. Vê tudo que `supervisor` vê + opções estratégicas (consolidados, aprovação de exceções, impersonar loja).

Roles existentes (`loja`, `colaborador`, `departamento`) continuam intactos.

### 2.2 Resolução do menu por papel (engine)

Trocar a linha única `tipoBot = loja_info?.tipo_bot || "loja"` por uma **resolução em camadas** que carrega múltiplos `tipo_bot` e concatena o menu na ordem hierárquica:

```text
papel detectado    →    tipo_bot carregados (na ordem)
─────────────────       ──────────────────────────────
loja               →    [loja]
colaborador        →    [colaborador]
departamento       →    [departamento]
supervisor         →    [supervisor, loja]                     ← supervisor herda menu de loja
diretor            →    [diretor, supervisor, loja, departamento]  ← diretor vê tudo
```

A função `loadMenuOpcoes(tipoBot, parentId)` vira `loadMenuOpcoesAggregated(tipoBots[], parentId)` e:
1. Busca opções com `tipo_bot IN (...)` e `parent_id = ...`.
2. Deduplica por `chave` (a primeira ocorrência ganha — quem está mais alto na lista vence).
3. Reordena por `ordem` dentro de cada `tipo_bot`, mas mantendo o agrupamento.

Submenus (parent_id) seguem o mesmo padrão.

### 2.3 Como o telefone "vira" supervisor/diretor

Adicionar uma coluna em `telefones_lojas`:

```text
papel_hierarquico text NOT NULL DEFAULT 'operacional'
  CHECK (papel_hierarquico IN ('operacional','supervisor','diretor'))
```

- `operacional` (default): comportamento atual — `tipo_bot` é o que dita o menu.
- `supervisor`: engine carrega `[supervisor, <tipo_bot original>]`.
- `diretor`: engine carrega `[diretor, supervisor, <tipo_bot original>, departamento]`.

Mantém o `tipo_bot` atual fazendo sentido (loja/colaborador/departamento descreve o **contexto operacional** — de qual ângulo a pessoa fala). `papel_hierarquico` descreve **o nível de poder**. Uma supervisora cadastrada como `tipo_bot=loja, papel_hierarquico=supervisor` ganha tudo o que a operadora vê + as ferramentas de supervisão.

Esse mesmo campo amarra com o `user_roles.papel_loja` proposto no plano de permissões web — uma única fonte de verdade.

### 2.4 Configuração visual no painel `/configuracoes`

#### a) `TelefonesLojasCard`
- Coluna nova **Papel hierárquico** (select inline: Operacional / Supervisor / Diretor).
- Badge colorido na linha quando supervisor/diretor.
- O wizard de cadastro em lote (`BulkUserProvisioningWizard`) já lê dessa tabela; passa o papel automaticamente para `user_roles.papel_loja`.

#### b) `BotFluxosCard` + `BotMenuCard`
- Adicionar `supervisor` e `diretor` aos selects de `tipo_bot`.
- Filtro por `tipo_bot` no topo do card já existe — só ampliar.
- Nas opções de menu, indicar visualmente quando a opção é "compartilhada" entre níveis (chip "também visível para supervisor / diretor").

#### c) Novo card opcional: `BotPapelHierarquiaCard`
- Mostra a tabela de **resolução de menu** (a tabela 2.2 acima) em formato de matriz.
- Permite reordenar a ordem em que os `tipo_bot` são empilhados, caso no futuro queiramos um diretor que NÃO veja o menu de loja, por exemplo.

### 2.5 Fluxos novos a cadastrar (proposta de catálogo inicial)

`tipo_bot=supervisor`:

| chave | nome | setor_destino |
|---|---|---|
| `aprovar_excecao_cpf` | Aprovar Exceção CPF | Financeiro |
| `consultar_meta_loja` | Consultar Meta da Loja | Financeiro |
| `autorizar_estorno_supervisao` | Autorizar Estorno (alçada supervisor) | Financeiro |
| `relatorio_diario_loja` | Relatório Diário da Loja | Atendimento Corporativo |
| `falar_diretoria` | Falar com Diretoria | Atendimento Corporativo |

`tipo_bot=diretor`:

| chave | nome | setor_destino |
|---|---|---|
| `aprovar_excecao_diretoria` | Aprovar Exceção (alçada diretoria) | Financeiro |
| `consolidado_redes` | Consolidado Multi-loja | Financeiro |
| `liberar_acesso_excepcional` | Liberar Acesso Excepcional | TI |
| `auditoria_supervisores` | Auditoria de Decisões de Supervisores | Atendimento Corporativo |

(Lista preliminar — podemos refinar depois com você. O importante agora é a estrutura.)

### 2.6 Wizard "Nova Demanda" (Messenger app interno)

`AcionarLojaDialog` e `DemandaLojaPanel` listam fluxos a partir de `bot_fluxos` para um operador escolher. Hoje filtram só os 14 fluxos. Após a mudança:

- Quando o **autor da demanda** é supervisor/diretor (lido de `user_roles.papel_loja` + `papel_hierarquico`), o select adiciona os fluxos exclusivos de supervisor/diretor.
- Quando o **destino** é supervisor/diretor, idem.

### 2.7 Migração de dados / compatibilidade

- Migration:
  - `ALTER TABLE telefones_lojas ADD COLUMN papel_hierarquico text NOT NULL DEFAULT 'operacional' CHECK (...)`.
  - Sem mudança nos 14 registros existentes (todos ficam `operacional`, comportamento idêntico ao de hoje).
- `bot_fluxos` e `bot_menu_opcoes` ganham linhas novas (semente) para `tipo_bot=supervisor` e `tipo_bot=diretor`.
- Engine `bot-lojas` reescreve `tipoBot` único para `tipoBots[]` agregados — modo `operacional` continua resolvendo só `[<tipo_bot>]`, então não muda nada para quem está hoje em produção.

---

## 3. Como isso encaixa no plano de permissões web (1 linha por área)

| Área | Web (módulos visíveis) | Bot (menu Messenger) | Fonte |
|---|---|---|---|
| Operadora de loja | `/lojas`, `/mensagens` | menu `loja` | `user_roles.papel_loja='operador'` + `telefones_lojas.papel_hierarquico='operacional'` |
| Supervisor de loja | + Dashboard, opcionalmente CRM read-only, escopo multi-loja | menu `[supervisor, loja]` | `papel_loja='supervisor'` (web) + `papel_hierarquico='supervisor'` (bot) |
| Diretor | tudo (sem `/configuracoes`) | menu `[diretor, supervisor, loja, departamento]` | `role='diretoria'` (web) + `papel_hierarquico='diretor'` (bot) |

Quem cadastra a pessoa na tela de `/configuracoes` define os dois lados de uma vez (web + bot) — fonte única de verdade.

---

## 4. Questões que ainda precisam ser respondidas (mantenho as 4 anteriores e adiciono 2)

1. **Diretoria** vê tudo no web (read-only) ou só dashboards consolidados?
2. **Supervisor de loja** deve ver CRM/Atendimentos das lojas dele?
3. Múltiplas lojas para um supervisor: N linhas em `user_roles` (recomendado) ou tabela nova?
4. `role='operador'` continua existindo ou consolida em admin/diretoria?
5. **(NOVO)** Os fluxos exclusivos de supervisor/diretor que listei na 2.5 — quais você confirma para o catálogo inicial e quais são mais prioritários?
6. **(NOVO)** Quando um supervisor cobre múltiplas lojas, o menu do bot deve perguntar "qual loja?" antes de cada operação (igual ao menu `departamento` faz hoje)? Ou ele opera sempre sobre uma loja "padrão" cadastrada e troca via comando `trocar loja`?

Após as respostas, eu encadeio: migration (`telefones_lojas.papel_hierarquico` + seeds), engine (`bot-lojas` agregando menus), web (`useAuth` + `TopNavigation` + `AppLayout`), UI de configuração (`TelefonesLojasCard`, `BotFluxosCard`, `BotMenuCard`, `BulkUserProvisioningWizard`, `GestaoUsuariosCard`) e `sso-login` no mesmo passo.