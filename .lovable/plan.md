

## Plano: Sistema de Aprendizado e Melhoria Contínua da IA

### O Problema

Hoje a IA responde com base no prompt fixo + knowledge base estática. Não há como saber se as respostas foram boas, nem mecanismo para ela "aprender" com correções humanas.

### Estratégia de Aprendizado (3 camadas)

```text
Camada 1: Feedback Loop (curto prazo)
  → Consultor avalia resposta da IA → bom/ruim + correção
  → Respostas corrigidas viram exemplos no prompt

Camada 2: Exemplos Dinâmicos (médio prazo)
  → Banco de "respostas modelo" aprovadas por humanos
  → Injetadas como few-shot examples no contexto da IA

Camada 3: Métricas e Calibração (longo prazo)
  → Dashboard com taxa de acerto, escalonamentos, satisfação
  → Ajuste de prompt baseado em dados reais
```

### 1. Migração SQL

**Tabela `ia_feedbacks`** — avaliação humana das respostas:

```sql
CREATE TABLE public.ia_feedbacks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mensagem_id uuid NOT NULL,        -- mensagem da IA avaliada
  atendimento_id uuid NOT NULL,
  avaliacao text NOT NULL,           -- 'positivo', 'negativo', 'corrigido'
  resposta_corrigida text,           -- resposta ideal (quando corrigido)
  motivo text,                       -- por que foi ruim
  avaliador_id uuid,                -- quem avaliou (profile)
  created_at timestamptz DEFAULT now()
);
```

**Tabela `ia_exemplos`** — respostas modelo para few-shot learning:

```sql
CREATE TABLE public.ia_exemplos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria text NOT NULL,           -- 'produtos', 'reclamacao', 'orcamento'
  pergunta text NOT NULL,            -- mensagem do cliente
  resposta_ideal text NOT NULL,      -- como a IA deveria responder
  ativo boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
```

### 2. Edge Function `ai-triage` — Injeção de Exemplos

Antes de chamar a OpenAI, carregar exemplos ativos da `ia_exemplos` e injetar como few-shot no `instructions`:

```text
EXEMPLOS DE RESPOSTAS APROVADAS (use como referência de tom e qualidade):

[PRODUTOS]
Cliente: "Quanto custa a lente multifocal?"
Resposta ideal: "As lentes multifocais começam a partir de R$..."

[RECLAMACAO]
Cliente: "Meu óculos veio com defeito"
Resposta ideal: "Lamento muito pelo inconveniente..."
```

Também carregar feedbacks negativos recentes como "anti-exemplos":

```text
ERROS RECENTES (EVITE REPETIR):
- Erro: Inventou preço de produto não cadastrado
- Correção: Sempre consultar a base de conhecimento antes de citar valores
```

### 3. UI — Painel de Feedback e Exemplos

**Na tela de Atendimentos** (ao visualizar conversa):
- Botão de polegar para cima/baixo em cada mensagem da IA
- Ao clicar "negativo": modal pedindo motivo + resposta corrigida
- Respostas corrigidas podem ser promovidas a "exemplo" com um clique

**Na tela de Configurações** — novo card "Aprendizado da IA":
- Lista de exemplos cadastrados (pergunta/resposta ideal, categoria, toggle ativo)
- Botão "Novo Exemplo" (manual)
- Estatísticas: total de feedbacks, % positivo, categorias com mais erros
- Feedbacks recentes negativos com opção de "criar exemplo a partir deste"

### 4. Métricas Automáticas

O `ai-triage` já loga eventos no `eventos_crm`. Adicionar campos:
- `confianca` (float) — score de confiança da IA na resposta
- `tokens_usados` — para monitorar custo
- `tempo_resposta_ms` — latência

Esses dados alimentam o dashboard de calibração.

### Fluxo de Aprendizado

```text
IA responde ao cliente
  ↓ Consultor vê a conversa
  ↓ Avalia: 👍 ou 👎
  ↓ Se 👎: escreve resposta corrigida + motivo
  ↓ Feedback salvo em ia_feedbacks
  ↓ Consultor promove para "exemplo modelo"
  ↓ Exemplo salvo em ia_exemplos (ativo = true)
  ↓ Próxima chamada do ai-triage carrega exemplos
  ↓ IA usa como few-shot reference
  ↓ Respostas melhoram progressivamente
```

### Componentes alterados

| Componente | Ação |
|---|---|
| Migração SQL | Criar `ia_feedbacks` e `ia_exemplos` com RLS |
| `ai-triage/index.ts` | Carregar exemplos ativos + anti-exemplos e injetar no instructions |
| `Atendimentos.tsx` | Botões de feedback (👍/👎) nas mensagens da IA |
| `Configuracoes.tsx` | Card "Aprendizado da IA" com gestão de exemplos e métricas |

### O que NÃO é (escopo claro)

- **Não é fine-tuning**: não treinamos um modelo customizado (caro e complexo)
- **Não é RAG vetorial**: não usamos embeddings (a knowledge base JSON já resolve)
- É **few-shot learning dinâmico** + **feedback humano** — simples, eficaz, sem custo extra de infra

