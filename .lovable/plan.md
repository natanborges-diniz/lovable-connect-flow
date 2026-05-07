## Receitas complexas (cyl>4 / add>3,5 / sphere 8-10): cotar normal + revisão humana pós-orçamento

### Mudanças em `supabase/functions/ai-triage/index.ts`

**1. Novo helper `requerRevisaoHumanaPosOrcamento(rx)` (perto da linha 217)**
Retorna `{ precisa, motivos[] }` para:
- `cylMax > 4` → `cilindrico_alto`
- `addMax > 3.5` → `adicao_alta`
- `sphereMax` em (8, 10] → `esferico_faixa_cinza`

(esférico > 10 continua escalando direto via `isReceitaForaDaFaixa`).

**2. Sufixo discreto na mensagem da cotação (`executeConsultarLentes`, antes do `return { resposta: quoteMsg }` na linha ~5396)**
Quando há resultados E `requerRevisaoHumanaPosOrcamento(rxMeta).precisa === true`, anexar ao `quoteMsg`:

> _💡 Como sua receita tem um detalhe específico, vou pedir uma conferência rápida do nosso consultor pra confirmar prazo e disponibilidade. Pode ir escolhendo a opção que mais te agrada que já adianto 🙌_

**3. Sinalização interna (mesmo bloco, sem escalar o atendimento)**
Se `precisa === true`:
- `eventos_crm.insert({ tipo: 'orcamento_revisao_humana', descricao, metadata: { motivos, rx, lenses: [ids/preços] }, referencia_tipo: 'atendimento', referencia_id: atendimentoId })`
- `notificacoes.insert({ tipo: 'orcamento_revisao', titulo: 'Orçamento com receita complexa — revisar', mensagem, setor_id: setor do contato (ou Vendas como fallback), referencia_id: atendimentoId })`
- `atendimentos.update({ metadata: { ...current, revisao_humana_pendente: true, revisao_motivos: motivos } })`

Idempotência: antes de inserir evento/notificação, checa se já existe `eventos_crm` com `tipo='orcamento_revisao_humana'` e mesmo `referencia_id` nos últimos 30min — evita disparo duplo se o cliente pedir reorçamento.

**4. Mantido**
- Esférico > 10 → escala direto (sem cotar) — sem mudança.
- Zero resultados → fallback de estimativa atual.
- Lentes de contato tóricas (cyl≥0.75) → regra existente de "sob encomenda".
- Modo do atendimento permanece `ia` — operador decide se assume.

### UI (opcional, só se trivial)
Se houver render do card de atendimento que já lê `metadata`, basta uma badge "Revisar orçamento" quando `revisao_humana_pendente === true`. Vou checar se existe componente óbvio (`AtendimentoCard` / `KanbanCard`); se exigir refatoração maior, deixo para um próximo passo e por enquanto a notificação no sino + evento no CRM já dão visibilidade.

### Memória
Atualizar `mem://ia/regras-negocio-e-proibicoes-criticas` adicionando:
> Receita complexa (cyl>4, add>3,5, sphere 8-10) NÃO escala — IA cota normal e dispara `eventos_crm.orcamento_revisao_humana` + notificação ao setor + flag `metadata.revisao_humana_pendente`. Esférico >10 segue escalando direto.

### Arquivos
- `supabase/functions/ai-triage/index.ts` (helper + sufixo + sinalizações)
- `mem://ia/regras-negocio-e-proibicoes-criticas` (atualização)
- (talvez) 1 badge em card de atendimento existente

Sem migrações de schema.
