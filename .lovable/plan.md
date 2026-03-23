

## Plano Unificado: Assistente IA com Triagem, Roteamento por Setor, Prompt Configurável e Modo Homologação

### Visão Geral

Cada mensagem WhatsApp recebida é processada automaticamente pelo assistente IA, que responde ao cliente em tempo real, classifica a intenção, move o contato para a coluna correta do Pipeline e roteia para o setor interno adequado. O operador só intervém quando o card chega na coluna "Atendimento Humano".

```text
WhatsApp → Webhook → Verifica modo (ia/humano)
                   → Verifica homologação (telefone na whitelist?)
                   → ai-triage (Lovable AI / Gemini)
                       → Resposta automática via send-whatsapp
                       → Classifica intenção
                       → Move card no Pipeline
                       → Roteia para setor interno
                       → Se necessário → Coluna "Atendimento Humano"
```

---

### Etapa 1 -- Migration SQL

**Tabela `configuracoes_ia`**
- `id`, `chave` (text unique), `valor` (text), `updated_at`
- Seed: `chave = 'prompt_atendimento'` com prompt completo das Óticas Diniz
- Seed: `chave = 'modo_homologacao'`, `valor = 'true'`
- RLS: authenticated ALL

**Tabela `contatos_homologacao`**
- `id`, `telefone` (text unique), `descricao` (text), `ativo` (boolean default true), `created_at`
- RLS: authenticated ALL

**Coluna `setor_destino` em `contatos`**
- uuid nullable, referência para `setores.id`
- Quando a IA classifica um contato em um setor, grava aqui; nas próximas mensagens, roteia direto

**Coluna `modo` em `atendimentos`**
- text default `'ia'` (valores: `ia` | `humano`)
- Quando operador envia mensagem manual, muda para `humano` e a IA para de responder

**Seed de colunas expandidas no Pipeline**
- Novo Contato, Orçamento, Informações Gerais, Reclamações, Parcerias, Compras, Marketing, Agendamento, Atendimento Humano, Fechado
- INSERT respeitando colunas já existentes (Lead, Qualificado, Proposta, Fechado permanecem se já criadas)

---

### Etapa 2 -- Configurações: Prompt IA + Modo Homologação

Na página `Configuracoes.tsx`, adicionar dois novos cards:

**Card "Prompt do Assistente IA"**
- Textarea grande com o prompt atual (carregado de `configuracoes_ia` onde `chave = 'prompt_atendimento'`)
- Botão Salvar, contagem de caracteres

**Card "Modo Homologação"**
- Switch ON/OFF (lê/grava `configuracoes_ia` onde `chave = 'modo_homologacao'`)
- Badge visual "HOMOLOGAÇÃO ATIVA" quando ON
- Lista de telefones de teste (CRUD na tabela `contatos_homologacao`)
- Quando OFF: IA responde para todos os contatos

---

### Etapa 3 -- Edge Function `ai-triage`

- Recebe `atendimento_id` e mensagem do cliente
- Busca prompt da tabela `configuracoes_ia`
- Busca últimas 20 mensagens do atendimento para contexto
- Busca colunas do pipeline e setores ativos
- Chama Lovable AI Gateway (`google/gemini-3-flash-preview`) com tool calling para extrair:
  - `resposta`: texto para enviar ao cliente
  - `intencao`: orcamento | status | reclamacao | parceria | compras | marketing | agendamento | informacoes | outro
  - `precisa_humano`: boolean
  - `setor_sugerido`: nome do setor (match com tabela `setores`)
  - `pipeline_coluna_sugerida`: nome da coluna destino
- Envia resposta via `send-whatsapp` (usando o provedor correto do atendimento)
- Atualiza `contatos.pipeline_coluna_id`, `contatos.setor_destino`, `contatos.ultimo_contato_at`
- Salva mensagem outbound na tabela `mensagens`
- Registra evento no `eventos_crm`

---

### Etapa 4 -- Atualizar `whatsapp-webhook`

Após salvar mensagem inbound:
1. Verifica `atendimentos.modo`: se `humano` → não chama IA
2. Se `modo = ia`, verifica homologação:
   - Busca `configuracoes_ia` onde `chave = 'modo_homologacao'`
   - Se `valor = 'true'`: verifica se telefone está em `contatos_homologacao` com `ativo = true`
   - Se NÃO está na whitelist → salva mensagem normalmente, sem resposta automática
   - Se ESTÁ ou homologação desligada → chama `ai-triage` (fire-and-forget)
3. Verifica `contatos.setor_destino`: se existir, usa para influenciar roteamento

---

### Etapa 5 -- Indicadores visuais no Pipeline

- Badge "IA" ou "Humano" nos cards (baseado em `atendimentos.modo`)
- Badge do setor destino quando atribuído
- Intenção classificada visível no card (metadata ou campo)
- Indicação de última interação (`ultimo_contato_at`)

---

### Etapa 6 -- Toggle IA/Humano nos Atendimentos

- Na tela de Atendimentos, botão para alternar modo IA ↔ Humano
- Quando operador envia mensagem manual no chat, automaticamente muda para `humano`
- Botão "Retomar IA" para voltar ao modo automático

---

### Componentes alterados

| Componente | Ação |
|---|---|
| Migration SQL | Criar `configuracoes_ia`, `contatos_homologacao`, adicionar `setor_destino` em contatos, `modo` em atendimentos, seed colunas |
| `supabase/functions/ai-triage/index.ts` | Criar (nova edge function) |
| `supabase/functions/whatsapp-webhook/index.ts` | Adicionar verificação de modo + homologação + chamada ao ai-triage |
| `src/pages/Configuracoes.tsx` | Cards: Prompt IA + Modo Homologação |
| `src/pages/Pipeline.tsx` | Badges de modo/setor/intenção nos cards |
| `src/pages/Atendimentos.tsx` | Toggle IA/humano |
| `src/hooks/useContatos.ts` | Suportar `setor_destino` |

### Sobre o modelo de IA

O plano usa Lovable AI (`LOVABLE_API_KEY` já configurada) com Gemini. Se no futuro preferir migrar para o assistente OpenAI existente, basta cadastrar `OPENAI_API_KEY` e adaptar a edge function -- a arquitetura permanece a mesma.

