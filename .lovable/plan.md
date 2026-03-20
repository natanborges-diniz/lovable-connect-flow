

## Plano Revisado: Arquitetura Dual-Number com Roteamento por Origem

### Regras de negócio (consolidadas)

1. **Mensagem chega por qualquer número** → responde pelo MESMO número/provedor que recebeu
2. **Atendimento aberto existe** → continua nele, no mesmo provedor
3. **API oficial só é usada proativamente** → quando o sistema/operador inicia conversa nova (sem histórico aberto) via template
4. **Transparente para operadores** → mesma interface, mesma lógica, badge indica provedor mas operador não escolhe
5. **Sem cruzamento de números** → se o cliente escreveu no não-oficial, resposta vai pelo não-oficial; se escreveu no oficial, vai pelo oficial

### Alterações no banco de dados

**Migração 1 — Novos campos:**

```sql
-- canais: identificar provedor
ALTER TABLE canais ADD COLUMN provedor text DEFAULT 'meta_official';
ALTER TABLE canais ADD COLUMN ativo boolean DEFAULT true;

-- atendimentos: saber por qual provedor a conversa acontece
ALTER TABLE atendimentos ADD COLUMN canal_provedor text DEFAULT 'meta_official';

-- mensagens: rastrear provedor por mensagem
ALTER TABLE mensagens ADD COLUMN provedor text;
```

### Alterações nas Edge Functions

**`whatsapp-webhook/index.ts`:**
- Ao criar canal, gravar `provedor` baseado no `source` (evolution_api, z_api, meta_official)
- Ao criar atendimento, gravar `canal_provedor` = source da mensagem
- Ao salvar mensagem, gravar `provedor` = source

**`send-whatsapp/index.ts`:**
- Ler `canal_provedor` do atendimento
- Se `meta_official` → envia via Graph API (como hoje)
- Se `evolution_api` → envia via Evolution API (requer secrets: `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE_NAME`)
- Se `z_api` → envia via Z-API (requer secrets: `ZAPI_INSTANCE_ID`, `ZAPI_TOKEN`, `ZAPI_URL`)
- Salva mensagem com `provedor` correspondente

**Nova função `send-whatsapp-template/index.ts`:**
- Para disparos proativos do sistema (assuntos novos sem histórico)
- Sempre usa API oficial Meta
- Recebe `contato_id`, `template_name`, `template_params`
- Cria solicitação + atendimento com `canal_provedor = 'meta_official'`

### Alterações no Frontend

**`Atendimentos.tsx`:**
- Exibir badge do provedor (ex: "Oficial" / "Evolution") — visual apenas
- Botão "Iniciar conversa" para contatos sem atendimento aberto → chama `send-whatsapp-template`
- `handleSend` não muda — já chama `send-whatsapp`, que agora roteia automaticamente

### Secrets necessários (novos)

- `EVOLUTION_API_URL` — URL da instância Evolution API
- `EVOLUTION_API_KEY` — Chave da Evolution API
- `EVOLUTION_INSTANCE_NAME` — Nome da instância Evolution

### Ordem de implementação

1. Migração do banco (3 campos novos)
2. Atualizar `whatsapp-webhook` para gravar `canal_provedor` e `provedor`
3. Atualizar `send-whatsapp` com roteamento por provedor (Meta vs Evolution)
4. Solicitar secrets da Evolution API
5. Criar `send-whatsapp-template` para disparos oficiais
6. Atualizar frontend (badge + botão iniciar conversa)
7. Atualizar types em `src/types/database.ts`

