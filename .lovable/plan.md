## Objetivo

Mudar o fluxo de correção da Auditoria IA: em vez de aprovar conversa-por-conversa (que gera regras/exemplos duplicados), o sistema **agrega os achados de toda a run em "problemas consolidados"** e o admin confirma a correção **uma única vez por problema**.

## Como vai funcionar (visão do usuário)

Ao abrir uma run de auditoria, o admin verá duas abas:

1. **Problemas consolidados** (default) — lista curta agrupada por tema. Cada item mostra:
   - Título do problema (ex.: "IA cita preço de Kodak")
   - Severidade dominante e nº de conversas afetadas
   - Diagnóstico unificado + correção proposta (1 ou mais ações: regra, exemplo, diretriz, tarefa TI)
   - Botões **Aplicar correção** / **Ignorar** / **Ver conversas afetadas**
2. **Por conversa** (modo atual, mantido para drill-down)

Aplicar a correção marca **todas as auditorias do grupo** como `aplicado` de uma só vez, evitando duplicidade.

## Como agrupar (técnico)

Novo edge function `audit-ia-consolidar` (chamado sob demanda quando o admin abre a run, ou ao final do `audit-ia-rodar`):

1. Lê todas as `ia_auditorias` da run com severidade ≥ warn.
2. Manda para o LLM (Gemini 2.5-pro) um lote com `{id, diagnostico, problemas, flags}` de cada achado e pede:
   - Agrupar por causa-raiz
   - Para cada grupo: título, descrição, severidade, lista de `auditoria_ids`, e `acoes_propostas[]` no mesmo formato hoje usado por `audit-ia-aplicar-correcao` (regra_proibida / exemplo / ajuste_prompt / tarefa_ti)
   - Deduplicar contra `ia_regras_proibidas`, `ia_exemplos`, `ia_instrucoes_prompt` ativas (passar lista resumida no prompt) — não propor nada que já exista.
3. Persiste em nova tabela `ia_auditorias_grupos`:

```text
ia_auditorias_grupos
  id uuid pk
  run_id uuid
  titulo text
  descricao text
  severidade text
  auditoria_ids uuid[]
  acoes_propostas jsonb     -- mesmo schema das ações de hoje
  status text               -- pendente | aplicado | ignorado
  ignorado_motivo text
  applied_at timestamptz
  created_at timestamptz
```

RLS: read autenticado, write service_role (igual `ia_auditorias`).

## Aplicação consolidada

Novo edge function `audit-ia-aplicar-grupo`:

- Recebe `{ grupo_id }`.
- Aplica cada ação de `acoes_propostas` **uma única vez** (mesma lógica do `aplicar-correcao` atual, extraída para função compartilhada inline).
- Cria 1 linha em `ia_auditorias_acoes` por ação aplicada, vinculada à **primeira** auditoria do grupo + `metadata.grupo_id` para rastreio.
- Atualiza `ia_auditorias_grupos.status = 'aplicado'` e marca todas as `ia_auditorias` do grupo como `status='aplicado'`.

`audit-ia-ignorar-grupo` análogo (marca grupo + auditorias como `ignorado` com motivo).

## Frontend

`AuditoriaIaCard.tsx` (`RunDetailSheet`):

- Adiciona Tabs "Problemas consolidados" / "Por conversa".
- Aba consolidada: query em `ia_auditorias_grupos` por `run_id`. Se vazia, botão **"Consolidar achados"** que invoca `audit-ia-consolidar` (loading state).
- Card por grupo com badge de severidade, contagem de conversas, lista de ações propostas (ícones já existentes), botões Aplicar/Ignorar/Ver conversas.
- "Ver conversas afetadas" abre lista filtrada (reusa componente atual).
- Fluxo por conversa permanece para casos pontuais.

## Migration

Criar tabela `ia_auditorias_grupos` com RLS conforme acima. Sem alterações em tabelas existentes.

## Arquivos

- **Novo:** `supabase/functions/audit-ia-consolidar/index.ts`
- **Novo:** `supabase/functions/audit-ia-aplicar-grupo/index.ts`
- **Novo:** `supabase/functions/audit-ia-ignorar-grupo/index.ts`
- **Migration:** tabela `ia_auditorias_grupos` + RLS
- **Editar:** `src/components/configuracoes/AuditoriaIaCard.tsx` (Tabs + nova lista de grupos)

## Fora de escopo

- Não altera o `audit-ia-rodar` (consolidação fica sob demanda; opcional disparar ao final num próximo round).
- Não mexe em `compile-prompt` — as tabelas de destino (regras/exemplos/instruções) continuam as mesmas.