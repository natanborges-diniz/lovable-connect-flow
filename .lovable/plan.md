
## Problema

Meta bloqueia texto livre fora de 24h do último inbound. Como o lembrete de véspera é enviado 1 dia antes da visita (e o último inbound do cliente costuma estar a 2–14 dias atrás), praticamente **todos** os lembretes véspera caem em `outside_24h_window` e morrem silenciosos. Resultado prático Jhanys: cliente nunca recebeu o lembrete, loja nunca confirmou, sistema marcou no-show.

## Solução

Não dá pra "convencer" a Meta — a regra é dela. A saída é **usar template HSM aprovado sempre que estivermos fora da janela**, e só usar texto livre quando estivermos dentro.

### 1. Template UTILITY dedicado a lembrete de visita

Criar (ou reaproveitar) `lembrete_agendamento` no catálogo `whatsapp_templates`:
- Categoria **UTILITY** (≈ 5–10× mais barato que MARKETING e a Meta aprova rápido pra esse caso de uso).
- Variáveis: `{{1}}` nome do cliente, `{{2}}` data/hora formatada, `{{3}}` loja, `{{4}}` endereço curto.
- Body sugerido: "Oi {{1}}, passando pra lembrar do seu horário na Óticas Diniz {{3}} em {{2}}. Endereço: {{4}}. Pode responder SIM pra confirmar ou me chamar aqui se precisar remarcar."
- Idioma `pt_BR`. Submeter à Meta pelo card existente em Configurações > Templates WhatsApp.
- Registrar **alias lógico** `lembrete_visita` → `lembrete_agendamento` em `template_aliases` (mesmo padrão das retomadas), pra trocar versão sem redeploy.

### 2. Lógica de envio com fallback automático

Em `agendamentos-cron`, `processLembreteVespera` e `processLembrete1hAntes`:

```text
1. Calcular horasDesdeUltimoInbound (igual o guard que send-whatsapp já faz)
2. Se ≤ 24h  → send-whatsapp (texto livre, como hoje)
3. Se > 24h ou sem inbound → send-whatsapp-template
                              template_alias='lembrete_visita'
                              params=[nome, data_formatada, loja, endereco]
4. Em ambos os casos, capturar o JSON de resposta inteiro
   (não só sendRes.ok)
```

Mesma estratégia em qualquer outro cron que ainda mande texto livre proativo (revisar `vendas-recuperacao-cron` — pelos logs ele também está batendo no 24h window).

### 3. Persistir motivo de falha

Quando `send-whatsapp` devolver erro:
- `metadata.lembrete_ok = false`
- `metadata.lembrete_erro = { code, reason, hours_since_last_inbound }` (hoje só fica `false` sem detalhe)
- `evento_crm` tipo `lembrete_vespera_falha` ganha `payload.motivo` com o mesmo objeto.

Mesma coisa para `lembrete_1h_antes_falha`.

### 4. Re-tentativa de Jhanys e órfãos retroativos

Script único (executado uma vez) que pega agendamentos com `lembrete_vespera_falha` + `motivo=outside_24h_window` ainda no futuro próximo (próximas 48h) e re-dispara o lembrete já pelo template novo, marcando idempotência com `metadata.lembrete_enviado_at`.

### 5. Memória

Atualizar `mem://agendamentos/janela-comunicacao-e-d-day` registrando: "lembretes véspera/1h sempre tentam template HSM quando fora de 24h; texto livre só dentro da janela".

## Detalhes técnicos

- Arquivos: `supabase/functions/agendamentos-cron/index.ts` (helpers `processLembreteVespera`, `processLembrete1hAntes`), `supabase/functions/send-whatsapp/index.ts` (já devolve o erro estruturado, só precisamos consumir), `supabase/functions/send-whatsapp-template/index.ts` (já existe e respeita `template_alias` + gate `approved`).
- Migração: nenhuma estrutural. Apenas inserts em `whatsapp_templates` (rascunho do `lembrete_agendamento`) e `template_aliases` (`lembrete_visita`).
- A submissão à Meta é manual via card existente — sem aprovação não há fallback real. Enquanto pending, o cron loga `template_pendente` e o evento `lembrete_vespera_falha` fica com `motivo=blocked_template_not_approved`, o que já é diagnóstico claro.
- Não mexe em RLS nem em horário comercial.

## Ordem de execução

1. Inserir template + alias e submeter à Meta (eu preparo o SQL e o texto sugerido).
2. Enquanto Meta analisa: implementar fallback + persistência de motivo + redeploy de `agendamentos-cron`.
3. Quando template ficar `approved`: trocar alias (1 clique), rodar o script de re-envio dos órfãos.
4. Atualizar memória.

Quer que eu siga por aí?
