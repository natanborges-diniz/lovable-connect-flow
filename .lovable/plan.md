## Visão Cliente 360 — Timeline unificada

Centraliza todo o histórico do cliente em uma página única, alimentada por tabelas já existentes (`eventos_crm`, `atendimentos`, `mensagens`, `agendamentos`, `cashback_*`, `regua_inscricao`, `regua_touchpoint`, `pagamentos_link`, `os_recebimento_loja`, `demandas_loja`, `canais`, `solicitacao_anexos`). **Zero tabelas novas** — só uma view consolidada e UI.

### 1. Acesso
- **Rota dedicada** `/contatos/:id` (nova página `ContatoDetalhe.tsx`).
- **Drawer rápido** `<Cliente360Drawer>` reaproveitável: gatilho no nome do cliente em CRM/Atendimentos/Agendamentos/Financeiro/Estoque. Drawer mostra resumo + botão "Abrir visão completa".
- Busca global no header (telefone, nome, CPF) abrindo a página direta.

### 2. Layout da página

```text
┌───────────────────────────────────────────────────────────┐
│ HEADER: Nome • telefone • status canal • tags • estágio   │
│ KPIs:  Cashback saldo • LTV • Última interação • NPS      │
├────────────┬──────────────────────────────────────────────┤
│ Sidebar    │ Tabs:                                        │
│ - Resumo   │  [Timeline] [Cashback] [LGPD/Docs] [Canais]  │
│ - Cards    │  [Atendimentos] [Agendamentos/OS] [Financ.]  │
│ ativos     │                                              │
└────────────┴──────────────────────────────────────────────┘
```

### 3. Aba Timeline (núcleo)
Lista cronológica reversa, agrupada por dia, com filtros (chips: Atendimento, Cashback, Régua, Agendamento, OS, Pagamento, Demanda, Consentimento, Canal). Busca textual e exportação CSV/PDF.

Cada item tem ícone, cor, título, snippet, atalho ("Abrir atendimento", "Ver OS"). Realtime via canal Supabase em `eventos_crm`.

Fontes consolidadas via nova **view `vw_contato_timeline`** (read-only, sem dados duplicados) que faz UNION de:
- `eventos_crm` (`contato_*`, `regua_*`, `cashback_*`)
- `atendimentos` (início/fim)
- `mensagens` resumidas (primeira+última de cada atendimento)
- `agendamentos` (criado/confirmado/no-show/concluído)
- `cashback_credito` e `cashback_resgate`
- `regua_inscricao` + `regua_touchpoint`
- `pagamentos_link` (criado/pago/expirado) e `pagamentos_link_eventos`
- `os_recebimento_loja` (cadastrado/recebido)
- `demandas_loja` (abertura/conclusão)

### 4. Aba Cashback
- Saldo atual + extrato (créditos e resgates) com loja, valor, validade.
- Lista de vendas com PIN: status (`pin_confirmado_at`, tentativas, expiração), versão dos termos aceita, canal de consentimento.

### 5. Aba LGPD/Documentos
- Linha por consentimento: versão (`termos_versao`), data, canal (`pin_whatsapp`/etc.), IP do consultor, link para o PDF dos termos.
- Receitas/anexos (`solicitacao_anexos` + `metadata.receita`).
- Comprovantes de pagamento vinculados aos `pagamentos_link`.
- Botão "Exportar dossiê LGPD" (PDF com tudo do cliente — direito de portabilidade).

### 6. Aba Canais
Painel de saúde por canal (telefone WhatsApp): status (`nao_validado/validado/pessoa_errada/invalido/sem_resposta`), 4 contadores, último motivo de falha, validado em, versão dos termos. Ações: "Reenviar PIN", "Marcar como inválido", "Trocar telefone principal" (cria novo registro em `canais`).

### 7. Aba Atendimentos
Lista paginada com filtros (canal, atendente, status). Cada linha abre o atendimento na rota existente.

### 8. Aba Agendamentos/OS
Tabela de agendamentos (com status terminal) + lista de OS de `os_recebimento_loja` com timeline mini de cada uma.

### 9. Aba Financeiro
Links de pagamento, status, valor, comprovante. Soma LTV.

### 10. Integração nos pipelines (drawer)
Adicionar botão "👤 Ver cliente" em:
- `EditCardInfoDialog` / cards CRM
- `Atendimentos.tsx` header da conversa
- `PipelineAgendamentos`, `PipelineFinanceiro`, `PipelineEstoque`
Drawer mostra resumo (KPIs + últimas 10 entradas da timeline) + link "Abrir 360".

### 11. Detalhes técnicos
- **DB**: 1 migration cria `vw_contato_timeline` (VIEW) + função `contato_timeline(_contato_id uuid, _limit int, _filtros text[])` SECURITY DEFINER que retorna paginado. Grants para `authenticated`.
- **Hooks**: `useContato360(id)`, `useContatoTimeline(id, filtros)`, `useContatoCashback(id)`, `useContatoConsentimentos(id)`, `useContatoCanais(id)`.
- **Componentes** em `src/components/contato360/`: `Header.tsx`, `KpiBar.tsx`, `TimelineFeed.tsx`, `TimelineItem.tsx`, `CashbackTab.tsx`, `LgpdTab.tsx`, `CanaisTab.tsx`, `AtendimentosTab.tsx`, `AgendamentosTab.tsx`, `FinanceiroTab.tsx`, `Cliente360Drawer.tsx`, `BuscaClienteGlobal.tsx`.
- **Página**: `src/pages/ContatoDetalhe.tsx` com rota em `App.tsx`.
- **Realtime**: subscription única em `eventos_crm` filtrada por `contato_id`.
- **Exportações**: PDF via `jspdf` (já instalado se houver, senão `pdf-lib`); CSV nativo.
- **Memória**: criar `mem://contatos/visao-360-cliente.md` documentando view + hooks + drawer reutilizável.

### Fora de escopo
- NPS real (apenas placeholder no KPI; integração futura).
- Edição de dados do contato (já existe em `Contatos.tsx`).
- Mesclagem de contatos duplicados.
- Atribuição de tags em massa.
