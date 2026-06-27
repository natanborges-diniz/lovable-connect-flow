## Escopo

Três frentes interligadas: (1) wizard de boleto no Messenger com parcelas, dia de vencimento, valor por parcela, flag de impresso e observação; (2) conclusão obrigatória no Financeiro com upload de 1+ arquivos PDF e transição automática para "Boleto Enviado"; (3) modelo de auto-arquivamento para todas as colunas terminais do Pipeline Financeiro, mantendo rastreabilidade completa fora do Kanban.

---

## 1. Wizard de Boleto (InFoco Messenger)

### Campos novos (após a tela de CPF aprovado)
- **Quantidade de parcelas** — input numérico 1 a 12.
- **Dia de vencimento** — 1 a 28 (limite seguro p/ todos meses).
- **Valor de cada parcela** — moeda; total = valor × qtd (mostrado dinamicamente).
- **Enviar boletos impressos?** — toggle Sim/Não.
- **Observação** — textarea opcional ("ex: 1ª parcela em data X, intervalo diferente, etc").

### Tela de aprovação (preview)
Antes do submit, o wizard exibe a projeção montada:
```
Parcela 1 — R$ XXX,XX — vence DD/MM/AAAA
Parcela 2 — R$ XXX,XX — vence DD/MM/AAAA
...
Total: R$ X.XXX,XX
```
- Primeira data = próxima ocorrência do dia escolhido a partir de hoje (se hoje > dia, pula para o mês seguinte).
- Demais parcelas = mesmo dia nos meses subsequentes (ajuste seguro até dia 28).
- Botões: **Voltar** / **Confirmar e enviar ao Financeiro**.

### Persistência
`solicitacoes.metadata` ganha:
```
parcelas: [{ numero, valor, vencimento }],
qtd_parcelas, dia_vencimento, valor_parcela, valor_total,
enviar_impresso: bool,
observacao_loja: string
```
Mantém `consulta_cpf_id`, `cpf`, `nome_cliente` herdados (já existem).

### Backend `criar-solicitacao-loja`
- Valida campos novos (Zod): qtd 1-12, dia 1-28, valor > 0, parcelas array consistente.
- Grava metadata acima + badge "🖨️ Impresso" quando `enviar_impresso=true`.
- Sem mudança no gate de CPF aprovado.

---

## 2. Conclusão no Financeiro

### Card do boleto (PipelineFinanceiro)
Aparece na coluna **"Solicitação de Boleto"** com:
- Resumo (cliente, CPF, total, qtd parcelas).
- Badge "Imprimir" quando `enviar_impresso=true`.
- Botões: **Concluir boleto** / **Devolver à loja**.

### Diálogo "Concluir boleto"
- Upload de **1 ou mais arquivos** (PDF/imagem) — mínimo 1, obrigatório mesmo quando impresso (registro do que foi gerado).
- Campo opcional "linha digitável" / "nosso número" (texto livre).
- Ao confirmar:
  - Faz upload no bucket `mensagens-anexos` em `boletos/{solicitacao_id}/{idx}-{ts}.{ext}`.
  - Grava `metadata.boletos_arquivos = [{url, nome}]`, `metadata.boletos_concluido_at`, `metadata.linha_digitavel`.
  - Move card para coluna **"Boleto Enviado"**.
  - Espelha mensagem na thread Messenger (`demanda_mensagens` direcao=`operador_para_loja`) com os anexos.
  - Notifica usuários da loja via `resolver_destinatarios_loja`.
  - Vincula bidirecional na `consulta_cpf` (já existe `boleto_solicitacao_id`).

### Edge function
Estende a `concluir-solicitacao-financeiro` existente com novo `modo='boleto'` (espelha o padrão `carta` / `comprovante_pagamento` já documentado).

---

## 3. Auto-arquivamento de colunas terminais

### Problema
Colunas terminais ("Link Enviado", "Link Pago", "PIX Confirmado", "PIX Não Confirmado", "Boleto Enviado", "Consulta CPF Reprovada/Aprovada", "Concluído", "Cancelado") crescem indefinidamente e poluem o Kanban.

### Solução proposta — abordagem híbrida
1. **Flag por coluna**: novo campo `pipeline_colunas.terminal boolean default false` + `pipeline_colunas.dias_auto_arquivar int` (default `7`).
2. **Marcar como terminais** as colunas listadas acima.
3. **Auto-arquivar**: card que estiver há ≥ N dias numa coluna terminal recebe `solicitacoes.metadata.arquivado_at` e desaparece do Kanban.
4. **Cron diário** (`auto-arquivar-cards`, 03:00 SP) faz a varredura.
5. **Visibilidade preservada**:
   - Toggle **"Mostrar arquivados"** no header da coluna (default OFF) — reexibe inline com badge cinza "Arquivado em DD/MM".
   - Cards continuam em `/financeiro/pagamentos`, `/relatorios/disparos`, Cliente 360 e busca global — nada é deletado.
   - Contador no header da coluna: `12 ativos · 47 arquivados`.
6. **Botão manual "Arquivar agora"** em cada card terminal (para o operador limpar antes do prazo).

### Por que essa forma é "clean + rastreável"
- Kanban fica enxuto: só o que precisa de ação humana próxima.
- Histórico completo permanece em tabelas-fonte (timeline do contato, relatórios, pagamentos_link) — nada é perdido.
- Reversível: basta desligar a flag de arquivado para o card reaparecer.
- Custo zero de migração de dados (só metadata).

---

## Arquivos afetados

### Atrium (este projeto)
- `supabase/migrations/...` — colunas `terminal`, `dias_auto_arquivar` em `pipeline_colunas`; marca terminais existentes; índice por `metadata->>'arquivado_at'`.
- `supabase/functions/concluir-solicitacao-financeiro/index.ts` — novo modo `boleto` (upload N arquivos, transição de coluna, espelho Messenger).
- `supabase/functions/auto-arquivar-cards/index.ts` — nova cron diária.
- `supabase/functions/criar-solicitacao-loja/index.ts` — valida + persiste parcelas/impresso/observação.
- `src/pages/PipelineFinanceiro.tsx` — botões Concluir/Devolver no card de boleto; toggle "Mostrar arquivados"; contadores; filtro de arquivados na query.
- `src/components/financeiro/ConcluirBoletoDialog.tsx` — novo dialog (upload N arquivos + linha digitável).
- `.lovable/memory/financeiro/boleto-via-cpf-aprovado.md` — atualizar com parcelas, impresso, conclusão.
- `.lovable/memory/financeiro/auto-arquivamento-terminais.md` — nova memória.

### InFoco Messenger (projeto separado — entrego depois desta aprovação)
- `src/pages/LojaNovaDemanda.tsx` — etapas novas (parcelas, dia, valor, impresso, observação) + tela de preview/aprovação antes do submit.

---

## Detalhes técnicos

- Geração de datas: usar `date-fns` (`addMonths`, `setDate`), limite dia 28 para evitar fevereiro.
- Upload múltiplo: input `<Input type="file" multiple accept="application/pdf,image/*" />`; loop client-side com `supabase.storage.from('mensagens-anexos').upload(...)`.
- Auto-arquivamento usa `metadata->>'arquivado_at' IS NULL` no filtro padrão do Kanban; toggle adiciona OR.
- Cron registrada em `cron_jobs` com payload editável (`{ dias_padrao: 7 }`).

---

## Fora deste plano (confirmar se entram)
- Geração automática de boletos via integração bancária (atualmente é manual pelo Financeiro).
- Notificação push ao cliente quando o boleto for enviado (hoje só espelha na thread da loja).
