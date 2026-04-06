

# Reestruturar Funil de Vendas + Ciclo de Vida + Link Google Maps

## 1. Ciclo de Funil (ciclo_funil)

Adicionar campo `ciclo_funil` (integer, default 1) na tabela `contatos`. Quando um contato sai de coluna terminal (Perdidos, Abandonado, Cancelado, Redirecionado) e retorna via inbound, o ciclo incrementa.

Isso permite:
- **Funil primário (ciclo 1)**: métricas puras de novos leads
- **Funil de reativação (ciclo 2+)**: métricas separadas de retorno
- Nenhum "lead reciclado" polui a conversão do funil primário

### Lógica no whatsapp-webhook

No trecho de CRM ROUTING (linha ~243), quando o contato está em coluna terminal e é movido para "Retorno":

```
ciclo_funil atual + 1
```

Gravar no contato junto com a mudança de coluna.

### Lógica no vendas-recuperacao-cron

Quando move para "Perdidos" após 3 tentativas, não altera o ciclo (ele só incrementa no retorno).

---

## 2. Escada de Persuasão (Link Google Maps)

Atualizar `buildRegionalCoverageBlock()` no ai-triage:

```
# COBERTURA REGIONAL — ESCADA DE PERSUASÃO
- Você atende APENAS em Osasco e região (Carapicuíba, Barueri, Jandira, Itapevi, Cotia, Santana de Parnaíba).
- Quando o cliente for de fora:
  1º) Convide com carinho para conhecer nossas lojas. Mencione diferenciais e promoções.
  2º) Se insistir, reforce com argumentos de acesso e atendimento diferenciado.
  3º) SOMENTE se o cliente se mostrar irredutível (3ª vez): envie o link do Google Maps e classifique como "fora_cobertura".
- NUNCA envie o link logo na 1ª ou 2ª interação sobre localização.
```

Quando classificar como "fora_cobertura", o ai-triage move o card para coluna "Redirecionado" (terminal).

---

## 3. Reestruturação de Colunas com grupo_funil

Adicionar coluna `grupo_funil` (text, nullable) em `pipeline_colunas`. Atualizar todas as colunas existentes:

```text
TRIAGEM        → Novo Contato (0), Retorno (1)
COMERCIAL      → Lead (10), Qualificado (11), Orçamento (12), Agendamento (13)
POS_VENDA      → Informações Gerais (20)
SAC            → Reclamações (30)
OUTROS         → Parcerias (40), Compras (41)
TERMINAL       → Atendimento Humano (90), Redirecionado (91), Perdidos (92)
```

---

## 4. View de Métricas + Dashboard

Criar view SQL `funil_metricas_vendas` que agrupa contatos por `grupo_funil` da coluna atual, filtrando por `ciclo_funil`:
- Total por grupo, taxa de conversão entre grupos sequenciais
- Separação ciclo 1 vs ciclo 2+

Adicionar gráfico de funil horizontal no Dashboard com filtro de ciclo.

---

## Arquivos afetados

| Arquivo | Mudança |
|---------|---------|
| Migration SQL | `ciclo_funil` em contatos, `grupo_funil` em pipeline_colunas, coluna "Redirecionado", reordenação, view métricas |
| `supabase/functions/whatsapp-webhook/index.ts` | Incrementar `ciclo_funil` ao mover de terminal → Retorno |
| `supabase/functions/ai-triage/index.ts` | Escada de persuasão regional, mover para "Redirecionado" |
| `src/pages/Dashboard.tsx` | Gráfico de funil com filtro ciclo 1 / ciclo 2+ |
| `src/hooks/usePipelineColunas.ts` | Incluir `grupo_funil` no tipo |

## Resultado

- Retornos incrementam ciclo e não poluem métricas de novos leads
- Gael tenta 2x convencer antes de entregar link do Google Maps
- Ao entregar link, card sai do radar (Redirecionado)
- Dashboard com funil visual e conversão por etapa, filtrado por ciclo

