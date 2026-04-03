

# Correção: Memória de Receitas Dinâmica e Multi-Pessoa

## Problema

Atualmente o sistema tem 3 falhas críticas:

1. **Sobrescrita**: `ultima_receita` é um campo único -- se o cliente manda receita dele e do filho, a segunda sobrescreve a primeira
2. **Amnésia**: Os dados da receita salva NUNCA são injetados no prompt das mensagens seguintes -- a IA "esquece" que já leu a receita
3. **Sem contexto de pessoa**: Não distingue "receita do cliente" vs "receita do filho"

## Solução

### 1. Mudar estrutura de armazenamento (em `contatos.metadata`)

De:
```json
{ "ultima_receita": { rx_type, eyes, ... } }
```

Para:
```json
{
  "receitas": [
    {
      "label": "cliente",
      "rx_type": "progressive",
      "eyes": { "od": {...}, "oe": {...} },
      "confidence": 0.92,
      "data_leitura": "2026-04-03T19:20:00Z"
    },
    {
      "label": "filho",
      "rx_type": "single_vision",
      "eyes": { "od": {...}, "oe": {...} },
      "confidence": 0.88,
      "data_leitura": "2026-04-03T19:25:00Z"
    }
  ]
}
```

Cada nova receita é adicionada ao array (append), não sobrescreve. Limite de 5 receitas por contato (FIFO).

### 2. Injetar contexto de receitas no system prompt

No bloco de carregamento paralelo (~linha 863), adicionar fetch de `contatos.metadata` do contato atual. Após construir o prompt (~linha 955), injetar bloco dinâmico:

```
# RECEITAS JÁ INTERPRETADAS NESTA CONVERSA

## Receita 1 (cliente) — lida em 03/04/2026
Tipo: Progressiva | Confiança: 92%
OD: esf -2.25 cil -0.75 eixo 180 add +2.00
OE: esf -1.75 cil -0.50 eixo 175 add +2.00

## Receita 2 (filho) — lida em 03/04/2026
Tipo: Visão simples | Confiança: 88%
OD: esf -3.00 cil -1.25 eixo 10
OE: esf -2.50 cil -0.75 eixo 170

⚠️ NÃO peça receita novamente. Use consultar_lentes referenciando a receita correta.
Quando o cliente pedir orçamento, pergunte "Para qual receita?" se houver mais de uma.
```

### 3. Atualizar tool `interpretar_receita` (linhas 1246-1264)

- Ao salvar, fazer **append** ao array `receitas` em vez de sobrescrever `ultima_receita`
- O modelo deve retornar um campo `label` (ex: "cliente", "filho", "mãe") baseado no contexto da conversa
- Adicionar `label` na definição da tool como parâmetro opcional
- Manter retrocompatibilidade: se existir `ultima_receita` legado, migrar para o novo formato `receitas[]`

### 4. Atualizar tool `consultar_lentes` (linhas 1282-1320)

- Ler do array `receitas[]` em vez de `ultima_receita`
- Se houver 1 receita: usar automaticamente
- Se houver 2+: a tool recebe parâmetro `receita_index` ou `label` para identificar qual usar
- Se o modelo não especificar qual: usar a mais recente

### 5. Atualizar description das tools

- `interpretar_receita`: adicionar parâmetro `label` com descrição "Identificador da pessoa (ex: 'cliente', 'filho', 'mãe'). Infira pelo contexto da conversa."
- `consultar_lentes`: adicionar parâmetro `receita_label` com descrição "Label da receita a usar. Se não especificado, usa a mais recente."

## Arquivo modificado

| Arquivo | Mudança |
|---------|---------|
| `supabase/functions/ai-triage/index.ts` | Todas as 5 alterações acima |

## Resultado

- Suporte a múltiplas receitas por conversa (cliente + filho, casal, etc.)
- IA nunca mais pede receita que já foi lida
- Quando há 2+ receitas, IA pergunta "Para qual?" antes de orçar
- Retrocompatível com dados existentes em `ultima_receita`

