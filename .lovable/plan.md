

# Plano: Seletor de Público na Recuperação

## Problema
Hoje, pra recuperar só clientes em massa, o admin precisa saber que "setor vazio/Vendas" = cliente e "Atendimento Corporativo" = loja. Não é óbvio.

## Solução
Adicionar no topo do `RecuperacaoCard.tsx` 3 botões de público que pré-aplicam filtros:

```text
┌──────────────────────────────────────────────────────────┐
│ Quem você quer recuperar?                                │
│ [👥 Clientes (23)] [🏪 Lojas/Internos (4)] [🌐 Todos (27)]│
└──────────────────────────────────────────────────────────┘
```

- **Clientes**: filtra `setor_id IS NULL` (CRM vendas) — é o caso "ligar produção pós-downtime"
- **Lojas/Internos**: filtra setores `Atendimento Corporativo`, `Lojas`, `Financeiro`, `TI`
- **Todos**: sem filtro

Os filtros avançados (idade, setor manual, modo) ficam abaixo num accordion "Filtros avançados" pra não poluir.

## Mudanças no Edge Function `recuperar-atendimentos`
- Aceitar parâmetro `publico=clientes|internos|todos` que mapeia internamente pros setores corretos
- Retornar contagem segmentada: `{ total, por_publico: { clientes: N, internos: M } }`

## Mudanças na UI `RecuperacaoCard.tsx`
- 3 botões grandes no topo com badge de contagem
- Tooltip explicativo em cada um
- Pré-visualização do lote: "Vai recuperar 23 clientes — IA reage em 18, escala humano em 5"
- Filtros atuais movidos pra accordion colapsado

## Arquivos
| Arquivo | Mudança |
|---------|---------|
| `supabase/functions/recuperar-atendimentos/index.ts` | Adicionar param `publico`, retornar contagem segmentada |
| `src/components/configuracoes/RecuperacaoCard.tsx` | Seletor de público + accordion filtros + preview lote |
| `src/hooks/useAtendimentosOrfaos.ts` | Passar `publico` no payload |

## O que NÃO muda
- Lógica de regra inteligente (<1h, 1-6h, >6h) permanece
- Ações individuais por linha permanecem
- Auditoria via `eventos_crm` permanece

