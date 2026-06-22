---
name: Visão 360 do cliente
description: Página /crm/contatos/:id e Cliente360Drawer reutilizável; timeline unificada via RPC contato_timeline e KPIs via contato_kpis. Sem tabelas novas.
type: feature
---

## Acesso
- **Rota**: `/crm/contatos/:id` (`src/pages/ContatoDetalhe.tsx`).
- **Drawer**: `src/components/contato360/Cliente360Drawer.tsx` — usar em qualquer card/pipeline passando `contatoId`. Mostra resumo (KPIs + últimas 20 entradas) + botão "Abrir visão completa".
- **Lista de Contatos**: linha clicável + ícone User abre a página 360.

## Backend (zero tabelas novas)

`contato_timeline(_contato_id uuid, _limit int, _offset int, _filtros text[])` — SECURITY DEFINER, retorna `(fonte, tipo, titulo, descricao, ocorrido_at, referencia_tipo, referencia_id, metadata)` ordenado desc. Fontes: `evento_crm`, `atendimento`, `agendamento`, `cashback`, `regua`, `pagamento`, `os`, `demanda`, `lgpd`. `_filtros` é array de fontes; NULL = todas.

`contato_kpis(_contato_id uuid)` retorna jsonb com `cashback_saldo`, `cashback_total_gerado`, `ltv` (pagamentos pagos + vendas validadas), `ultima_interacao`, `atendimentos_total`, `agendamentos_total`, `os_total`.

Realtime: subscription em `eventos_crm` filtrada por `contato_id` invalida o cache da timeline. Como a RPC consolida várias tabelas, mutações em pagamentos/agendamentos só refletem em refetch manual ou navegação — aceitável para 360.

## Hooks (`src/hooks/useContato360.ts`)

- `useContato(id)` — registro de `contatos`
- `useContatoKpis(id)` — RPC `contato_kpis`
- `useContatoTimeline(id, filtros?)` — RPC `contato_timeline` + realtime
- `useContatoCanais(id)` — saúde por canal (status, contadores, motivo de falha)
- `useContatoCashback(id)` — créditos + resgates
- `useContatoConsentimentos(id)` — `regua_inscricao` com `pin_confirmado_at IS NOT NULL`

## UI

Abas: **Timeline** (busca + chips de filtro por fonte + export CSV), **Cashback** (créditos/resgates), **LGPD/Documentos** (consentimentos com versão/IP/canal), **Canais** (status + 4 contadores enviadas/entregues/lidas/respondidas).

Componentes em `src/components/contato360/`: `TimelineFeed`, `Cliente360Drawer`.

## Para reuso futuro

Para abrir o drawer em qualquer pipeline:
```tsx
const [open360, setOpen360] = useState<string | null>(null);
<Cliente360Drawer contatoId={open360} open={!!open360} onOpenChange={() => setOpen360(null)} />
<button onClick={() => setOpen360(card.contato_id)}>Ver cliente</button>
```
