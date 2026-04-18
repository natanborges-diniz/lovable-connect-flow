---
name: Canal Demandas Operador↔Loja (Privado)
description: Canal privado entre operador e loja. Auto-routing absoluto enquanto demanda aberta (texto+mídia). Encerramento por operador, #encerrademanda da loja, ou auto após 30min.
type: feature
---

# Canal "Demanda à Loja"

Canal **paralelo e privado** entre operador (CRM) e loja, vinculado ao atendimento de um cliente específico.

## Regras absolutas

1. **Resposta da loja NUNCA chega ao cliente automaticamente.** O operador é filtro obrigatório — lê, edita se preciso, e clica "Encaminhar ao cliente" via `encaminhar-demanda-cliente`.
2. **Botão "Solicitar à loja" só aparece em modo humano** no atendimento. IA não pode abrir demanda.
3. **A loja não vê o número do cliente** — apenas "Cliente: <nome>".
4. **Atendimento espelho da loja** (criado por `criar-demanda-loja`) é marcado com `metadata.suprimir_ia=true`, `suprimir_bot=true`, `atendimento_demanda=true`. `ai-triage` e `bot-lojas` abortam imediatamente ao ver essas flags.

## Hard-guard corporativo no webhook

`whatsapp-webhook` faz lookup em `telefones_lojas` **ANTES** de criar/buscar contato, usando `brPhoneCandidates(phone)` (variantes BR com/sem o dígito 9). Sem isso, números corporativos virariam contato `tipo='cliente'` no CRM com nome do `senderName` ("Franciana" no lugar de "Loja Teste"). Lookup em `contatos` também usa `.in("telefone", phoneVariants)` pra evitar duplicatas.

`criar-demanda-loja` aplica a mesma normalização ao buscar/criar o contato espelho da loja.

## Auto-routing absoluto (sem prefixo, todos os tipos)

Em `whatsapp-webhook`, `routeDemandaResposta` decide:

1. Se a loja tem **qualquer** demanda aberta/respondida → **TODA** mensagem (texto, foto, áudio, vídeo, doc) vai pra `demanda_mensagens` com `tipo_conteudo` e `anexo_url`. Sem exigir `#NN`. Se houver várias demandas abertas, sempre roteia pra mais recente.
2. **Único comando especial**: `#encerrademanda` (regex `/^#\s*encerrar?\s*demanda/i`) → invoca `encerrar-demanda-loja` com `encerrado_por='loja'` e notifica operador.
3. Bot/IA **nunca** rodam enquanto há demanda aberta. O comando `menu` foi removido como escape — pra acessar bot, loja precisa encerrar a demanda primeiro (via #encerrademanda ou aguardar operador/auto-encerramento).

Mensagens roteadas marcam `demandas_loja.status='respondida'` + `vista_pelo_operador=false` + `ultima_mensagem_loja_at`. **Pula completamente bot-lojas/ai-triage.**

## Encerramento (3 caminhos)

`encerrar-demanda-loja` aceita `encerrado_por: 'operador' | 'loja' | 'auto'` e envia mensagem WA personalizada via Evolution:

- **operador**: clica "Encerrar demanda" no `DemandaThreadDialog`. Requer JWT.
  - WA: *"✅ Demanda DEM-AAAA-NNNNN encerrada pelo operador. Obrigado! Para nova solicitação, digite menu."*
- **loja**: envia `#encerrademanda`. Chamada interna do webhook (`X-Internal-Caller`). Notifica operador via `notificacoes`.
  - WA: *"✅ Demanda DEM-AAAA-NNNNN encerrada por você. Para nova solicitação, digite menu."*
- **auto**: cron `auto-encerrar-demandas` (a cada 5min) encerra demandas com `updated_at < now() - 30min`. Notifica operador.
  - WA: *"⏰ Demanda DEM-AAAA-NNNNN encerrada automaticamente por inatividade (30min). Para nova solicitação, digite menu."*

Em todos os casos: `status='encerrada'` + `encerrada_at`, nota `direcao='sistema'` na thread (com `metadata.encerrado_por`), e `bot_sessoes` ativa do atendimento da loja é resetada (próxima msg cai no menu corporativo limpo).

## Tabelas

- `demandas_loja`: protocolo `DEM-YYYY-NNNNN`, `numero_curto`, `status` (aberta/respondida/encerrada), `vista_pelo_operador`, `solicitante_id`, vincula `atendimento_cliente_id`.
- `demanda_mensagens`: thread privada (operador_para_loja, loja_para_operador, sistema), com `encaminhada_ao_cliente`, `tipo_conteudo`, `anexo_url`, `anexo_mime` e `metadata` (`encerrado_por`, `match_type`).

## Edge Functions

- `criar-demanda-loja`: valida modo humano, gera protocolo + número curto, cria/atualiza atendimento da loja com flags de supressão e `canal_provedor='evolution_api'`, envia WA formatado pra loja.
- `encaminhar-demanda-cliente`: envia texto editado pelo operador para o atendimento do cliente, marca msgs da loja como encaminhadas.
- `encerrar-demanda-loja`: aceita `encerrado_por`, envia mensagem padronizada via Evolution, reseta `bot_sessoes`, notifica operador quando encerramento é não-operador.
- `auto-encerrar-demandas`: cron a cada 5min — busca demandas `updated_at < now() - 30min` em status `aberta|respondida` e chama `encerrar-demanda-loja` com `encerrado_por='auto'`.

## UI

`DemandaLojaPanel` lista demandas com badges por status; `DemandaThreadDialog` tem botão "Encerrar demanda" e textarea editável para encaminhar ao cliente.
