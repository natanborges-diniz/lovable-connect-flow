## Badge "Revisão humana pendente" em /crm/conversas

A flag já é gravada pelo `ai-triage` em `atendimentos.metadata.revisao_humana_pendente` (com `revisao_motivos[]`). Falta expor isso na UI de conversas.

### Mudanças em `src/pages/Atendimentos.tsx`

**1. Lista (tabela em ~linha 118)** — adicionar badge âmbar ao lado do `AtendimentoStatusBadge` quando `a.metadata?.revisao_humana_pendente === true`:
- Texto: `⚠ Revisar orçamento`
- Estilo: `border-amber-500/60 text-amber-600 bg-amber-50/40`
- `title` (tooltip) lista os motivos traduzidos (cilindrico_alto → "Cilíndrico alto (>4)", adicao_alta → "Adição alta (>3,5)", esferico_faixa_cinza → "Esférico 8–10").

**2. Header do detalhe (~linha 324)** — mesmo badge, mais visível, ao lado do `AtendimentoStatusBadge` no diálogo de conversa.

**3. Filtro novo no `<Select>` de status (~linha 83)** — opção extra **fora** do enum status:
- `revisao_pendente` → "⚠ Revisão pendente"
- Quando selecionado: filtra client-side por `metadata.revisao_humana_pendente === true` (não envia ao hook). Mantém os outros filtros como hoje.

**4. Botão "Resolver revisão"** no header do detalhe (só aparece se a flag for true): faz `update` em `atendimentos.metadata` removendo `revisao_humana_pendente` e `revisao_motivos`, e insere `eventos_crm` `tipo: 'orcamento_revisao_resolvida'` com o `user_id` que resolveu. Toast de confirmação. Realtime já refaz a query.

### Helper compartilhado

Criar `src/components/shared/RevisaoHumanaBadge.tsx`:
- Props: `motivos?: string[]`, `size?: "sm" | "md"`.
- Renderiza badge âmbar com tooltip dos motivos traduzidos.
- Reutilizável em outras telas (Pipeline cards, etc.) no futuro.

### Sem mudanças necessárias

- Schema (já gravado pelo backend).
- Hooks (`useAtendimentos` já traz `metadata`).
- `ai-triage` (lógica de gravação intacta).

### Memória

Adicionar nota curta em `mem://ia/regras-negocio-e-proibicoes-criticas` registrando que a flag é exibida em `/crm/conversas` (lista + detalhe) e pode ser resolvida manualmente pelo operador.

### Arquivos tocados

- `src/pages/Atendimentos.tsx` (badge na lista, no header, filtro, botão resolver)
- `src/components/shared/RevisaoHumanaBadge.tsx` (novo)
- `mem://ia/regras-negocio-e-proibicoes-criticas` (nota da UI)
