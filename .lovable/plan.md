

## Plano: Conectar Evolution API (Railway) ao Sistema

### Situação atual
A Evolution API está rodada no Railway com 3 serviços online (Redis, Evolution API, Postgres). Falta configurar a instância WhatsApp, o webhook e os secrets.

### Passos para configuração (manual no Railway/Evolution)

**1. Obter a URL pública da Evolution API**
- No Railway, clique no serviço "Evolution API" → Settings → Networking → copie o domínio público (ex: `evolution-api-production-0a3...up.railway.app`)

**2. Criar instância WhatsApp na Evolution**
- Fazer POST para `https://{SUA_URL}/instance/create`:
```json
{
  "instanceName": "crm-whatsapp",
  "qrcode": true,
  "integration": "WHATSAPP-BAILEYS"
}
```
- Header: `apikey: {SUA_GLOBAL_API_KEY}` (definida nas env vars do Railway)

**3. Conectar o número (escanear QR Code)**
- GET `https://{SUA_URL}/instance/connect/crm-whatsapp`
- Escanear o QR Code com o celular do número não-oficial

**4. Configurar o Webhook apontando para o sistema**
- POST `https://{SUA_URL}/webhook/set/crm-whatsapp`:
```json
{
  "url": "https://kvggebtnqmxydtwaumqz.supabase.co/functions/v1/whatsapp-webhook",
  "webhook_by_events": false,
  "events": ["MESSAGES_UPSERT"]
}
```

### Passos no Lovable (implementação)

**5. Cadastrar 3 secrets no projeto:**
- `EVOLUTION_API_URL` → URL pública do Railway
- `EVOLUTION_API_KEY` → Global API Key configurada no Railway
- `EVOLUTION_INSTANCE_NAME` → `crm-whatsapp`

**6. Nenhuma alteração de código necessária**
- O `whatsapp-webhook` já reconhece payloads da Evolution API
- O `send-whatsapp` já roteia por `canal_provedor = evolution_api`

### Ordem
1. Você configura passos 1-4 no Railway/Evolution
2. Eu cadastro os 3 secrets (passo 5)
3. Testamos enviando uma mensagem pelo número não-oficial

