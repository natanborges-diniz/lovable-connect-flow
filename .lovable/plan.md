

## Objetivo
Antes de qualquer mitigação, **comprovar se o número não-oficial está mesmo bloqueado** e identificar a causa-raiz com evidências. Sem dados, qualquer plano é especulação.

## Plano de diagnóstico (somente leitura, sem mudanças de código)

### 1) Comprovar status do número na Evolution
- **Health check direto na instância Evolution**: chamar `GET {EVOLUTION_API_URL}/instance/connectionState/{EVOLUTION_INSTANCE_NAME}` via `supabase--curl_edge_functions` ou criar uma checagem temporária. Estados possíveis: `open` (ok), `connecting` (instável), `close` (desconectado/banido).
- **Fetch QR / status**: `GET /instance/fetchInstances` retorna info detalhada (profilePicUrl, status, owner). Se `status=close` e não reconecta com QR → forte indício de ban.
- **Tentativa controlada de envio**: enviar 1 mensagem de teste para um número conhecido nosso via `send-whatsapp` forçando `force_provider=evolution_api`. Capturar resposta exata da API (códigos 401/403/`number not registered`/`instance not connected` têm significados diferentes).

### 2) Linha do tempo do incidente (logs Edge Functions + DB)
- `supabase--edge_function_logs` em `send-whatsapp`, `bridge-mensageria`, `whatsapp-webhook` filtrando por `EVOLUTION` / `error` / `status=` nas últimas 72h. Identificar:
  - Primeira ocorrência de erro consistente (timestamp T0 do bloqueio).
  - Padrão de erro retornado (`number does not exist`, `instance disconnected`, `forbidden`, timeout).
- `supabase--read_query` em `mensagens` para volume outbound por hora nas 48h antes de T0:
  ```sql
  SELECT date_trunc('hour', created_at) hora, count(*) total,
         count(*) FILTER (WHERE provedor='evolution_api') evolution,
         count(DISTINCT atendimento_id) atendimentos
  FROM mensagens
  WHERE direcao='outbound' AND created_at > now() - interval '72 hours'
  GROUP BY 1 ORDER BY 1;
  ```
- Inbound recebido após T0: se zerou, confirma desconexão da instância (não só envio).

### 3) Sinais de causa-raiz (5 hipóteses, evidências para cada)
| Hipótese | Como comprovar |
|---|---|
| **a) Volume/burst** (rate limit) | Pico anormal de outbounds/hora vs. baseline; muitas mensagens em <60s para contatos diferentes |
| **b) Cold contacts** (iniciar conversa fora de janela 24h sem template) | `mensagens` outbound onde não houve inbound do mesmo contato nas últimas 24h antes do envio |
| **c) Reports de spam** | Aumento súbito de `read=false` + sem resposta + `precisa_humano` baixo (clientes ignorando) |
| **d) Conteúdo proibido** (links repetidos, copy promocional) | Amostragem de conteúdos outbound nas 24h antes de T0 — repetição de mesmo texto para muitos destinos |
| **e) Erro de identidade** (instância caiu sozinha, não foi ban) | `connectionState=close` mas Evolution retorna possibilidade de novo QR → não é ban Meta, é reconexão de sessão |

### 4) Correlação com automatismos
Listar disparos automáticos das últimas 72h que poderiam ter gerado pico:
- `vendas-recuperacao-cron` — quantos `retomada_contexto_*` enviados? (mesma copy, muitos destinos = bandeira vermelha)
- `agendamentos-cron` — confirmações/lembretes em massa
- `watchdog-inbound-orfao` — re-disparos de IA
- `bot-lojas` — saudações automáticas

```sql
SELECT remetente_nome, count(*) total, min(created_at) primeiro, max(created_at) ultimo
FROM mensagens
WHERE direcao='outbound' AND provedor='evolution_api'
  AND created_at > now() - interval '72 hours'
GROUP BY 1 ORDER BY 2 DESC;
```

### 5) Verificação externa (opcional)
- Pedir ao usuário para abrir WhatsApp no celular do número afetado e relatar:
  - Aparece "Este número está banido por violar os Termos de Serviço"?
  - Consegue logar via QR code ainda?
  - Mensagem do WhatsApp Business Support no app?
- Esse sinal humano é o único 100% confiável para distinguir **ban definitivo** vs. **desconexão de sessão**.

## Entregável do diagnóstico
Ao final desta fase eu gero um **relatório**:
- Status confirmado (banido / desconectado / instável).
- T0 do incidente.
- Hipótese de causa com evidências numéricas.
- Recomendação (reconectar QR, migrar contatos, ajustar cron, etc.) — sem executar nada ainda.

## Arquivos/ações desta fase
- Nenhuma edição de código.
- Apenas: `supabase--edge_function_logs`, `supabase--read_query`, `supabase--curl_edge_functions` (health-check Evolution), e confirmação visual do usuário no celular.

