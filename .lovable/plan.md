


## Plano Unificado: OpenAI Responses API + Knowledge Base

### Status: ✅ Implementado

---

## Plano: Bot de Autoatendimento para Lojas + Link de Pagamento

### Status: ✅ Implementado

---

## Plano: Suporte a Imagens no WhatsApp + Assistente Autônomo

### Status: ✅ Implementado

### Componentes criados/alterados

| Componente | Status |
|---|---|
| Migração SQL (`tipo_conteudo` + bucket `whatsapp-media`) | ✅ |
| `supabase/functions/whatsapp-webhook/index.ts` (captura de imagens multi-provedor) | ✅ |
| `supabase/functions/ai-triage/index.ts` (agente autônomo multimodal) | ✅ |

### Capacidades implementadas

| Capacidade | Descrição |
|---|---|
| Receber imagens | Meta (Graph API download), Evolution API (URL direta), Z-API |
| Storage | Bucket `whatsapp-media` público com organização por atendimento |
| Vision/Multimodal | GPT-4o interpreta imagens no histórico de chat |
| Tool: classify_and_respond | Classificação e resposta padrão (já existia) |
| Tool: interpretar_receita | Extrai dados de receita oftalmológica (grau, eixo, adição, tipo lente) |
| Tool: solicitar_humano | Escalonamento com contexto para Consultor especializado |

### Fluxo de imagem

```text
Cliente envia foto via WhatsApp
  ↓ webhook detecta tipo (image/document/audio/video)
  ↓ baixa mídia via Graph API (Meta) ou URL direta (Evolution)
  ↓ salva no bucket whatsapp-media/{atendimento_id}/{message_id}.ext
  ↓ grava mensagem com tipo_conteudo e media_url no metadata
  ↓ ai-triage monta input multimodal (image_url + texto)
  ↓ GPT-4o escolhe tool adequada (interpretar_receita ou classify_and_respond)
  ↓ executa ação e responde ao cliente
```

### Próximas evoluções planejadas

- Tool `gerar_orcamento`: Criar orçamento baseado em receita + tabela de preços
- Tool `consultar_status_pedido`: Buscar status por CPF ou OS
- Tool `agendar_visita`: Registrar intenção de visita à loja
- Suporte a áudio: transcrição via Whisper antes de enviar ao agente
