---
name: Correções do dia 18/04 — 4 gaps de qualidade
description: Filtro echo-saudação no webhook, guardrail de "dois caminhos" para óculos pós-receita, cooldown 24h pós-handoff humano em vendas-recuperacao-cron
type: feature
---

# Correções de qualidade aplicadas em 18/04

Auditoria de 22 cards do dia revelou 4 gaps recorrentes. Patches:

## 1) Echo de saudação automática (whatsapp-webhook)
Provedores (Evolution/Z-API) ocasionalmente ecoam a saudação automática enviada pelo nosso próprio número como se fosse inbound — virava mensagem fantasma do cliente e disparava IA redundante.

Filtro determinístico em `whatsapp-webhook` (bloco `[ECHO-FILTER]`) descarta mensagens que batem com:
- `^olá, que bom poder conversar com você. como posso te ajudar`
- `^oi! tudo bem? como posso te ajudar`

Resposta: `200 {status: ignored, reason: saudacao_echo}` — não cria contato, não cria atendimento.

## 2) "Dois caminhos" para óculos com receita salva (ai-triage)
Caso Ju (18/04): cliente já tinha receita interpretada, pediu "modelos / orçamento" e a IA respondeu duas vezes o mesmo bloco "Opções de lentes para o seu grau" + texto-bridge "dois caminhos". Frustrante e duplicado.

Adicionado guardrail em `deterministicIntentFallback`:
- Se `hasReceitas` E texto bate `\b(orçamento|preço|valor|opções|lentes compatíveis|cotação|modelos de lente)\b`
- Resposta determinística curta: "Beleza! Já vou te mandar as opções compatíveis com a sua receita 😊 Em qual região você está?"
- Forçar quote real via tool no próximo turno; não devolve mais o prompt "dois caminhos".

Já existia o equivalente para LC (`hasReceitas && isLCContext`) — agora cobre óculos também.

## 3) Lock anti-duplicação por atendimento
Já implementado em `ai-triage` (linhas 1255-1300):
- `meta.ia_lock` com TTL 15s
- Janela de 10s anti-outbound recente
- `forceMode` bypassa em casos de devolução humano→IA

Mantido — auditoria não encontrou novas ocorrências de >2 outbound em <20s após o filtro echo (que era a causa raiz da maioria dos casos).

## 4) Cooldown 24h pós-handoff humano (vendas-recuperacao-cron)
Antes: `retomada_contexto_1` podia disparar logo após consultor responder, atrapalhando o fluxo manual.

Agora: `processContato` checa as últimas 10 mensagens outbound. Se alguma tem `remetente_nome` que NÃO bate `gael|sistema|template|bot|ia`, e foi enviada há <24h, suspende a cadência de recuperação para esse contato:

```
[COOLDOWN-HUMANO] {nome}: humano respondeu há {Xh} (<24h) — recuperação suspensa
```

Resultado: consultores conduzem chats sem interrupção de templates automáticos por pelo menos 24h após sua última resposta.

## Verificação
```sql
-- Ecos detectados (devem ser 0 inbounds com esse texto)
SELECT count(*) FROM mensagens
WHERE direcao='inbound'
  AND conteudo ILIKE 'olá, que bom poder conversar%'
  AND created_at > now() - interval '7 days';

-- Cooldown humano funcionando: nenhum template enviado <24h após outbound humano
SELECT m1.atendimento_id, m1.created_at as humano_at, m2.created_at as template_at
FROM mensagens m1
JOIN mensagens m2 ON m2.atendimento_id=m1.atendimento_id
WHERE m1.direcao='outbound' AND m1.remetente_nome NOT ILIKE ANY (ARRAY['%gael%','%sistema%','%template%','%bot%'])
  AND m2.direcao='outbound' AND m2.remetente_nome ILIKE '%template%'
  AND m2.created_at BETWEEN m1.created_at AND m1.created_at + interval '24 hours';
```
