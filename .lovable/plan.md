

## Plano Unificado: OpenAI Responses API + Knowledge Base

### Resumo

Duas mudanças coordenadas na mesma implementação:
1. Migrar o `ai-triage` do Lovable AI Gateway (Gemini) para a **OpenAI Responses API**
2. Criar tabela `conhecimento_ia` e injetá-la como contexto na IA
3. Card de gestão da Knowledge Base em Configurações

### 1. Migração SQL — Tabela `conhecimento_ia`

```sql
CREATE TABLE public.conhecimento_ia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria text NOT NULL DEFAULT 'produtos',
  titulo text NOT NULL,
  conteudo jsonb NOT NULL DEFAULT '{}',
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.conhecimento_ia ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage conhecimento_ia"
  ON public.conhecimento_ia FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE TRIGGER update_conhecimento_ia_updated_at
  BEFORE UPDATE ON public.conhecimento_ia
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

### 2. Edge Function `ai-triage/index.ts`

**Mudanças:**

| Aspecto | Antes | Depois |
|---|---|---|
| API | Lovable AI Gateway (`ai.gateway.lovable.dev`) | OpenAI Responses API (`api.openai.com/v1/responses`) |
| Auth | `LOVABLE_API_KEY` | `OPENAI_API_KEY` |
| Modelo | `google/gemini-2.5-pro` | `gpt-4o` |
| Formato request | `messages` + `tools` + `tool_choice` | `instructions` + `input` + `tools` + `tool_choice` |
| Formato response | `choices[0].message.tool_calls[0]` | `output[].type === "function_call"` |
| Knowledge Base | Não existia | Carrega `conhecimento_ia` e injeta no `instructions` |

**Estrutura da chamada:**

```text
POST https://api.openai.com/v1/responses
{
  "model": "gpt-4o",
  "instructions": "[prompt do banco] + [regras anti-repetição] + [knowledge base] + [modo híbrido se aplicável]",
  "input": [
    ...histórico de chat,
    { "role": "user", "content": "MENSAGEM ATUAL: ..." }
  ],
  "tools": [{ "type": "function", "name": "classify_and_respond", ... }],
  "tool_choice": "required"
}
```

**Parsing da resposta:**
```typescript
const functionCall = aiData.output.find(item => item.type === "function_call");
const result = JSON.parse(functionCall.arguments);
```

**Knowledge Base no instructions:**
- Carrega todos os registros ativos de `conhecimento_ia`
- Agrupa por categoria
- Injeta como bloco no `instructions`:
```
BASE DE CONHECIMENTO (consulte para responder sobre produtos/serviços):

[PRODUTOS]
{conteúdo JSON}

[POLÍTICAS]
{conteúdo JSON}
```

**Toda a lógica preservada:** modo híbrido, anti-repetição, terminologia "Consultor especializado", pipeline, setores.

### 3. UI — Card "Base de Conhecimento" em `Configuracoes.tsx`

Novo card com:
- Botão "Novo Item" abrindo dialog com: categoria (select: produtos/serviços/políticas/FAQ), título, textarea para colar JSON
- Tabela listando itens: título, categoria, badge ativo/inativo, toggle, botão excluir
- Preview do conteúdo JSON (primeiras linhas truncadas)

### Componentes alterados

| Componente | Ação |
|---|---|
| Migração SQL | Criar tabela `conhecimento_ia` com RLS |
| `supabase/functions/ai-triage/index.ts` | Reescrever: OpenAI Responses API + injeção de knowledge base |
| `supabase/config.toml` | Adicionar config para `ai-triage` com `verify_jwt = false` |
| `src/pages/Configuracoes.tsx` | Novo card "Base de Conhecimento" |

### Fluxo completo

```text
ai-triage recebe mensagem
  ↓ carrega prompt (configuracoes_ia)
  ↓ carrega conhecimento_ia (WHERE ativo = true)
  ↓ monta instructions (prompt + knowledge + anti-repetição + híbrido)
  ↓ monta input (histórico + mensagem atual destacada)
  ↓ chama OpenAI Responses API com function calling
  ↓ parse output → classify_and_respond
  ↓ envia resposta, atualiza pipeline, loga evento
```

