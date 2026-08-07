---
name: Debounce do ai-triage nunca descarta mensagem do cliente
description: Guard "outbound <10s" agora espera e reprocessa em vez de skip; router de escalada por palavra-chave roda antes do debounce em qualquer modo
type: feature
---

# Caso Kamila (06/08/2026)

Cliente escreveu "Falar com atendente" 5s após a IA responder. O guard anti-duplicidade
(`outbound <10s → skipped`) cortava a execução **antes** do router de escalada, então a
mensagem sumia. O watchdog de inbound órfão, que seria a rede de segurança, estava com
cron retornando 401 (chave antiga após rotação) desde 29/07.

## Regras permanentes

1. **Router de escalada por palavra-chave (`matchesEscalation`) roda no PRE-ROUTER**, antes
   dos skips de modo e antes do debounce/lock. Vale para qualquer modo exceto `humano`.
   Motivo do handoff: `keyword_pre_router`.
2. **Debounce nunca descarta inbound.** Se há outbound <10s, o ai-triage aguarda o restante
   da janela e só aborta se surgir um outbound NOVO (posterior ao existente) — ou seja, se
   outra execução respondeu. Caso contrário processa normalmente.
3. **Crons devem usar a chave publishable** (`apikey` + `Authorization`) — jobs com
   `sb_secret_*` antigos quebram silenciosamente após rotação. Jobs reagendados:
   `watchdog-inbound-orfao-1min`, `auto-arquivar-cards-diario`,
   `regua-disparo-aguardando-armacao-10h`. Diagnóstico: `net._http_response` com
   `status_code=401` / "Unregistered API key".
