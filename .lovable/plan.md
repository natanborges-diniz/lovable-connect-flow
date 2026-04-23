

## Canal Único Cliente — WhatsApp Meta Official (auditoria + fechamento)

### Diagnóstico atual

O canal Meta Official **já é o caminho de produção** para clientes finais, mas o código carrega resíduos de Evolution/Z-API que precisam ser eliminados para evitar comportamento errático após o ban da API não-oficial.

| Camada | Estado | Ação |
|---|---|---|
| `send-whatsapp` (saída) | ✅ Só Meta. Bloqueia fora da janela 24h pedindo template | Manter |
| `send-whatsapp-template` (proativo) | ✅ Meta + gate de template aprovado | Manter |
| `whatsapp-webhook` (entrada) | ⚠️ Aceita Meta mas ainda parseia Evolution/Z-API/Generic | Restringir só a Meta + log de payload desconhecido |
| `whatsapp-webhook` saneamento corporativo | ✅ ok | Manter |
| `canais.provedor` em novos contatos | ⚠️ grava `source` (poderia vir `evolution_api` legado) | Forçar `meta_official` sempre |
| `bot-lojas` (legado WA corporativo) | ✅ já desativado em fluxo, mas função existe | Já planejado (descontinuação separada) — não escopo aqui |
| Echo-saudação filter | ⚠️ patterns desenhados para Evolution/Z-API | Reduzir/manter como defensivo, sem custo |
| `Atendimentos.tsx` UI badge | ⚠️ ainda mostra "Evolution"/"Z-API" como rótulos possíveis | Simplificar para "Oficial" / "Legado" |
| `EVOLUTION_*` secrets | ⚠️ ainda no projeto | Marcar para remoção manual em Connectors (não-bloqueante) |
| Verificação real do webhook Meta | ❌ Sem logs recentes em `whatsapp-webhook` | Validar GET (verify_token) + POST de teste |

### O que será feito (ordem de execução)

**1. Endurecer `whatsapp-webhook` para Meta-only**
- Remover branches de parsing Evolution / Z-API / Generic em `normalizeWebhookPayload`. Deixar só Meta.
- Payload não-Meta → retornar 200 com log `unknown_payload_meta_only` (não 4xx, para Meta não retentar mal).
- Forçar `provedor: "meta_official"` ao inserir em `canais` (em vez de `source`).
- Remover bloco de download de mídia via Evolution (`getBase64FromMediaMessage`, header `apikey`, fallback de URL com `EVOLUTION_API_KEY`). Manter só o caminho Meta `/{media_id}` → URL temporária → download com Bearer.
- Tipo `NormalizedMessage.source` reduzido a `"meta_official"`.

**2. Reforçar `send-whatsapp`**
- Já está Meta-only; só remover o param `force_provider` da assinatura (legado, sem uso) e atualizar callers para parar de mandá-lo. Hoje 0 callers passam — só limpeza.

**3. UI — `Atendimentos.tsx`**
- Badge de provedor: `meta_official` → "Oficial" (verde). Qualquer outro valor histórico → "Legado" (cinza). Sem mais "Evolution"/"Z-API" como labels ativos.

**4. Verificação operacional do webhook**
- Após deploy, testar via `curl_edge_functions`:
  - `GET /whatsapp-webhook?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=12345` → deve retornar `12345`.
  - `POST` com payload Meta sintético (text inbound) de um número de teste → deve criar contato + atendimento + disparar `ai-triage`.
- Conferir logs (`whatsapp-webhook`, `ai-triage`, `send-whatsapp`) para confirmar fluxo end-to-end com o novo Phone Number ID já configurado nos secrets.

**5. Higiene do `ai-triage` (revisão, sem reescrita)**
- Auditar que nenhum branch crítico depende de `canal_provedor !== "meta_official"`. Se houver, remover. (Pré-checagem aponta apenas leitura defensiva — sem mudanças esperadas.)

**6. Memórias atualizadas**
- `mem://arquitetura/canal-unico-meta-e-app-atrium` — anotar conclusão da fase: Evolution/Z-API removidos do código (não só "deprecated").
- Nova `mem://integracao/whatsapp-meta-only-webhook` — documenta que o webhook só aceita payload Meta, com instruções de verificação.

### Fora de escopo (próximos passos sugeridos, não nesta entrega)

- Remover secrets `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE_NAME` (manual em Connectors).
- Descontinuar webhook da `bot-lojas` legada (já planejado em conversa anterior).
- Revisão profunda do prompt do Gael (assunto separado — depois do canal estabilizado).

### Critério de aceite

- `whatsapp-webhook` GET responde 200 com challenge usando `WHATSAPP_VERIFY_TOKEN`.
- Mensagem inbound real chega → contato criado/encontrado → atendimento aberto → IA responde via `send-whatsapp` (Meta) e operador vê no `/atendimentos` com badge "Oficial".
- Nenhum código ativo referencia Evolution/Z-API exceto a `bot-lojas` legada (que já está desativada por flag).
- Configurações > Canal Único continua mostrando "Pronto" para Meta.

