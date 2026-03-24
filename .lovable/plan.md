

## Plano: Suporte a Imagens no WhatsApp + Assistente Autônomo

### Diagnóstico Atual

**Imagens**: O webhook atual **ignora todas as mensagens que não são texto**. Na linha 304 do `normalizeWebhookPayload`, só processa `msg.type === "text"`. Imagens, áudios, documentos e stickers são descartados silenciosamente. O mesmo ocorre na Evolution API, que só extrai `conversation` e `extendedTextMessage`.

**Autonomia do assistente**: O ai-triage atual classifica e responde, mas não executa ações. Ele sugere colunas e setores, mas não cria orçamentos, não agenda, não consulta dados de pedidos.

### Parte 1: Receber e Interpretar Imagens

| Componente | Mudança |
|---|---|
| Storage bucket | Criar bucket `whatsapp-media` para armazenar imagens recebidas |
| `whatsapp-webhook` | Expandir `normalizeWebhookPayload` para capturar `image`, `document`, `audio` (Meta: baixar via Graph API; Evolution: extrair `imageMessage.url`) |
| `whatsapp-webhook` | Ao receber imagem: baixar o arquivo, salvar no bucket, gravar URL pública na `mensagens.metadata` e no `conteudo` como referência |
| `mensagens` | Adicionar campo `tipo_conteudo` (text, image, document, audio) para diferenciar mensagens |
| `ai-triage` | Ao montar o `input` para a OpenAI, incluir imagens como `image_url` no content (GPT-4o já suporta vision nativamente) |

**Fluxo de imagem:**

```text
Cliente envia foto da receita via WhatsApp
  ↓ webhook detecta msg.type === "image"
  ↓ baixa o media via Graph API (Meta) ou URL direta (Evolution)
  ↓ salva no bucket whatsapp-media
  ↓ grava mensagem com tipo_conteudo = "image" e URL no metadata
  ↓ ai-triage recebe e monta input multimodal:
      { role: "user", content: [
        { type: "image_url", image_url: { url: "..." } },
        { type: "text", text: "Cliente enviou esta receita" }
      ]}
  ↓ GPT-4o interpreta a receita oftalmológica
  ↓ responde com os dados extraídos (grau, tipo de lente, etc.)
```

### Parte 2: Assistente Mais Autônomo (Agente com Tools)

Evoluir o ai-triage de um classificador para um **agente com ferramentas**. Em vez de apenas `classify_and_respond`, ele terá múltiplas tools que pode chamar:

| Tool | O que faz |
|---|---|
| `classify_and_respond` | (já existe) Classifica e responde |
| `interpretar_receita` | Extrai dados de uma imagem de receita oftalmológica (grau, eixo, adição, tipo de lente) e salva no contato |
| `consultar_status_pedido` | Busca status de pedido por CPF ou numero de OS no sistema |
| `gerar_orcamento` | Cria orçamento baseado nos dados da receita + tabela de preços da knowledge base |
| `solicitar_humano` | Escalona para consultor especializado com contexto |
| `agendar_visita` | Registra intenção de visita à loja mais próxima |

**Arquitetura de execução:**

```text
ai-triage recebe mensagem (texto ou imagem)
  ↓ monta input multimodal (texto + imagens se houver)
  ↓ chama OpenAI Responses API com TODAS as tools disponíveis
  ↓ OpenAI decide qual(is) tool(s) usar
  ↓ para cada tool_call:
      ↓ executa a ação correspondente (query DB, criar registro, etc.)
      ↓ retorna resultado para o modelo
  ↓ modelo gera resposta final ao cliente
  ↓ envia via send-whatsapp
```

A OpenAI Responses API suporta múltiplas tool calls em sequência, permitindo que o agente interprete a receita E gere um orçamento na mesma interação.

### Migração SQL

```sql
-- Campo tipo_conteudo na mensagens
ALTER TABLE mensagens ADD COLUMN tipo_conteudo text DEFAULT 'text';

-- Bucket para mídia
INSERT INTO storage.buckets (id, name, public) VALUES ('whatsapp-media', 'whatsapp-media', true);
-- RLS para o bucket
```

### Ordem de Implementação

1. **Bucket + campo tipo_conteudo** (migração SQL)
2. **Webhook: captura de imagens** (download + storage + normalização)
3. **ai-triage: input multimodal** (enviar imagens ao GPT-4o)
4. **Tool `interpretar_receita`** (extração de dados de receita)
5. **Tools de ação** (orçamento, status, agendamento) — iterativo

### Detalhes Técnicos

- **Download de mídia Meta**: `GET https://graph.facebook.com/v21.0/{media_id}` para obter a URL, depois `GET url` com Bearer token para baixar o binário
- **GPT-4o Vision**: Já funciona com a Responses API, basta incluir `image_url` no content do input
- **Multi-tool calling**: A Responses API pode retornar múltiplos `function_call` items no `output`, cada um executado sequencialmente

