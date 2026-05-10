
# Auditoria IA Sob Demanda — com Aplicação Automática Inteligente

## Mudança vs versão anterior

O administrador **não decide mais o tipo de correção** (regra/exemplo/tarefa/prompt). Ele só faz 2 coisas por achado:

- **Concordo** que é um problema → IA escolhe a melhor forma de corrigir e aplica.
- **Não é problema / Ignorar** (com motivo opcional).

A IA de correção avalia cada caso e escolhe entre: regra proibida, few-shot, ajuste de instrução do prompt-compiler, tarefa para o setor TI (quando exige código/tool nova), ou combinação delas.

## Fluxo

```text
[Configurações → Auditoria IA]
   ┌──────────────────────────────┐
   │ Janela: 6h / 24h / 3d / 7d / │
   │         Custom...            │
   │ Severidade mínima: warn ▾    │
   │ Amostra de "limpos": 10%     │
   │ [▶ Rodar auditoria]          │
   └──────────────────────────────┘
            ▼
   audit-ia-rodar (sob demanda)
   - heurísticas determinísticas
   - LLM rubrica (gemini-2.5-pro)
   - grava ia_auditorias
            ▼
   Lista de achados (pior primeiro)
            ▼
   Drill-down de 1 conversa:
   ┌──────────────────────────────┐
   │ Transcrição (msg IA flagada  │
   │ destacada)                   │
   │                              │
   │ Diagnóstico da IA:           │
   │  "Confirmou receita vazia    │
   │   apesar do cliente dizer    │
   │   que não tinha a foto."     │
   │                              │
   │ [✓ Concordo, corrigir]       │
   │ [✗ Não é problema] (motivo)  │
   └──────────────────────────────┘
            ▼ (Concordo)
   audit-ia-aplicar-correcao
   - LLM "engenheiro de prompt"
     decide: regra | exemplo |
     ajuste prompt | tarefa TI
   - aplica e registra a decisão
            ▼
   Achado mostra:
   ✓ Aplicado como: "Regra proibida"
     + texto da regra
     + link pra editar/desfazer
```

## Como a IA escolhe a forma de correção

Função `audit-ia-aplicar-correcao` recebe `auditoria_id` e roda um classificador LLM (gemini-2.5-pro) com a transcrição + diagnóstico. Ele retorna **uma ou mais ações**:

| Tipo de problema detectado | Forma de correção escolhida |
|---|---|
| IA disse algo factualmente errado/proibido (preço, marca, promessa) | **Regra proibida** em `ia_regras_proibidas` |
| IA respondeu mal a um padrão de pergunta recorrente | **Few-shot** em `ia_exemplos` (pergunta cliente + resposta ideal) |
| IA ignorou contexto ou fluxo (ex.: confirmou receita inválida, não pediu nome) | **Ajuste de instrução** no prompt-compiler (linha em tabela nova `ia_instrucoes_prompt`) |
| Falta tool, bug de código, integração quebrada | **Tarefa TI** em `tarefas` com diagnóstico técnico |
| Tom inadequado / formal demais / repetitivo | **Few-shot** + regra de tom |

Heurísticas de roteamento (no system prompt do classificador):

- Se o problema é **conteúdo proibido específico** → `regra_proibida`.
- Se é **padrão repetível de bom comportamento** → `exemplo`.
- Se é **regra de fluxo/decisão** que não cabe em pergunta-resposta → `ajuste_prompt`.
- Se exige **mudança de código / tool nova / integração** → `tarefa_ti`.
- Pode escolher **combinação** (ex.: regra + exemplo).

O administrador **vê o que foi aplicado** (com o texto exato) e tem botão "Desfazer" / "Editar" caso discorde da execução. Mas não precisa decidir antes.

## UI simplificada

Aba `Configurações → Auditoria IA`:

1. **Painel de Run** (igual à versão anterior): janela + severidade + slider de amostra + botão.
2. **Histórico de runs**: lista das últimas execuções.
3. **Detalhe da run** — lista de achados ordenada por severidade. Cada linha:
   - contato, hora, score, tags, **status** (`pendente` / `aplicado` / `ignorado`).
4. **Drill-down (Sheet)** — UI **com 2 botões só**:
   - `✓ Concordo, corrigir` → dispara `audit-ia-aplicar-correcao`, mostra spinner, depois revela o que foi aplicado.
   - `✗ Não é problema` → modal com motivo opcional, marca como ignorado.
   - Painel "Correções aplicadas" lista cada ação (regra/exemplo/instrução/tarefa) com link de edição/desfazer.

Sem combobox de tipo, sem campos de texto pra preencher manualmente. Admin só decide *se* é problema.

## Reversibilidade

Toda ação aplicada vira uma linha em `ia_auditorias_acoes`:

```sql
create table ia_auditorias_acoes (
  id uuid primary key default gen_random_uuid(),
  auditoria_id uuid references ia_auditorias(id),
  tipo text,                      -- regra_proibida|exemplo|ajuste_prompt|tarefa_ti
  alvo_tabela text,               -- ia_regras_proibidas|ia_exemplos|ia_instrucoes_prompt|tarefas
  alvo_id uuid,                   -- id da linha criada
  payload jsonb,                  -- texto aplicado, pra exibir e desfazer
  desfeita boolean default false,
  desfeita_at timestamptz,
  desfeita_por uuid,
  created_at timestamptz default now()
);
```

Botão "Desfazer" desativa a linha alvo (`ativo=false` em regras/exemplos/instruções, ou cancela tarefa) e marca `desfeita=true`. Auditoria volta pra `pendente`.

## Schema

Sobre o plano anterior, mantém `ia_auditorias_runs` e `ia_auditorias`, com 3 ajustes:

- `ia_auditorias.problemas` continua, mas o admin **não interage com `sugestao_correcao` por item** — a UI consolida tudo num só botão "Concordo".
- Nova tabela `ia_auditorias_acoes` (acima) registra cada efeito colateral.
- Nova tabela `ia_instrucoes_prompt` (linhas que o `prompt-compiler` injeta como bullets na seção "Diretrizes operacionais"):

```sql
create table ia_instrucoes_prompt (
  id uuid primary key default gen_random_uuid(),
  categoria text not null,        -- fluxo|tom|seguranca|fechamento|...
  instrucao text not null,
  ativo boolean default true,
  origem text default 'auditoria',
  origem_ref uuid,                -- ia_auditorias.id
  created_at timestamptz default now()
);
```

`prompt-compiler` passa a ler também essa tabela (já lê `ia_regras_proibidas` e `ia_exemplos`). Linhas novas entram no próximo prompt sem deploy.

## Edge Functions

- **`audit-ia-rodar`** (sob demanda) — igual ao plano anterior; processa janela escolhida, grava `ia_auditorias`.
- **`audit-ia-aplicar-correcao`** (nova, substitui `audit-ia-aplicar-acao`):
  - Body: `{ auditoria_id }`. **Sem `tipo` vindo do front.**
  - Roda classificador LLM com transcrição + problemas detectados.
  - Para cada ação retornada, cria linha na tabela alvo + linha em `ia_auditorias_acoes`.
  - Atualiza `ia_auditorias.status='aplicado'` e retorna sumário das ações.
- **`audit-ia-desfazer-acao`** (nova): desativa alvo + marca `desfeita=true`.
- **`audit-ia-ignorar`** (nova): marca auditoria como `ignorado` com motivo.

## Validação

1. Rodar auditoria das últimas 24h.
2. Caso Yuri (receita vazia confirmada): clicar "Concordo, corrigir" → IA deve escolher **ajuste_prompt** ("nunca confirmar receita com campos `?`/`unknown`") e/ou **regra proibida** ("não enviar mensagem de confirmação se algum campo da receita for `?`").
3. Caso "cliente perguntou preço Kodak e IA respondeu valor": IA deve escolher **regra proibida**.
4. Caso "cliente disse 'já viajei sem receita' e IA insistiu": IA deve escolher **exemplo** (pergunta+resposta_ideal).
5. Botão "Desfazer" reverte a linha aplicada e devolve achado pra `pendente`.
6. Próxima compilação do prompt já reflete regras/instruções/exemplos novos.

## Arquivos

- **Migration nova**: `ia_auditorias_runs`, `ia_auditorias`, `ia_auditorias_acoes`, `ia_instrucoes_prompt`. RLS leitura `authenticated`, escrita `service_role`.
- **Edge functions**: `audit-ia-rodar`, `audit-ia-aplicar-correcao`, `audit-ia-desfazer-acao`, `audit-ia-ignorar`.
- **Edit em `prompt-compiler`**: passar a injetar `ia_instrucoes_prompt` ativas.
- **UI**: `src/components/configuracoes/AuditoriaIaCard.tsx`, `AuditoriaIaRunDetail.tsx`, `AuditoriaIaConversaSheet.tsx`, `useAuditoriaIa.ts`. Aba em `src/pages/Configuracoes.tsx`.
- Reuso de `montarTranscricao()` (extraído de `summarize-atendimento`) e similaridade do `watchdog-loop-ia`.

## Fora do escopo

- Cron automático (intencionalmente removido).
- Auditoria de atendimentos humanos.
- Auto-aplicação sem aprovação do admin (admin sempre confirma "concordo").
- Tendências/gráficos longitudinais entre runs.
