---
name: Canal Demandas Operador↔Loja (Privado)
description: Canal privado entre operador e loja para foto/disponibilidade de peça. Auto-roteamento sem #NN, atendimento espelho com IA/bot suprimidos, encerramento explícito pelo operador.
type: feature
---

# Canal "Demanda à Loja"

Canal **paralelo e privado** entre operador (CRM) e loja, vinculado ao atendimento de um cliente específico.

## Regras absolutas

1. **Resposta da loja NUNCA chega ao cliente automaticamente.** O operador é filtro obrigatório — lê, edita se preciso, e clica "Encaminhar ao cliente" via `encaminhar-demanda-cliente`.
2. **Botão "Solicitar à loja" só aparece em modo humano** no atendimento. IA não pode abrir demanda.
3. **A loja não vê o número do cliente** — apenas "Cliente: <nome>".
4. **O atendimento espelho da loja (criado por `criar-demanda-loja`) é marcado** com `metadata.suprimir_ia=true`, `suprimir_bot=true`, `atendimento_demanda=true`, e `modo='ia'`. `ai-triage` e `bot-lojas` abortam imediatamente ao ver essas flags — assim a loja não cai no fluxo padrão de cliente nem no menu corporativo enquanto a demanda está aberta.

## Hard-guard corporativo no webhook (CRÍTICO)

`whatsapp-webhook` faz lookup em `telefones_lojas` **ANTES** de criar/buscar contato, usando `brPhoneCandidates(phone)` (variantes BR com/sem o dígito 9 do celular — Meta às vezes entrega 12 dígitos, Evolution 13). Isso é fundamental porque:
- Se não checasse, números corporativos virariam contato `tipo='cliente'` no CRM, com nome do `senderName` do WhatsApp (ex: "Franciana" ao invés de "Loja Teste").
- Lookup `contatos` também usa `.in("telefone", phoneVariants)` pra evitar duplicatas (12 vs 13 dígitos).
- Se `isLojaEarly`, contato é criado/atualizado com `tipo=loja|colaborador`, `setor_destino=Atendimento Corporativo`, `pipeline_coluna_id=NULL`, nome = `nome_loja`/`nome_colaborador` cadastrado (NUNCA senderName), `metadata.nome_confirmado=true`.

`criar-demanda-loja` aplica a mesma normalização ao buscar/criar o contato espelho da loja.

## Roteamento de respostas da loja

Em `whatsapp-webhook`, antes de invocar `bot-lojas`/`ai-triage`, `routeDemandaResposta` (que também usa `brPhoneCandidates`) decide:

1. **Comando `menu`** (texto exatamente "menu") → escapa: cai no `bot-lojas` normal sem afetar a demanda. Permite à loja consultar pagamentos/boletos sem encerrar.
2. **Prefixo `#NN`** (`#42`, `#DEM-42`, `#dem42`...) → match explícito por `numero_curto`. Útil quando a loja tem múltiplas demandas abertas.
3. **Sem prefixo + 1 demanda aberta para essa loja** → auto-roteia (`match_type=auto_single`). Não exige que a loja saiba do código.
4. **Sem prefixo + múltiplas demandas abertas** → roteia pra mais recente (`match_type=auto_most_recent`) e loga warning. Operador deve pedir `#NN` quando isso acontecer.

Toda mensagem roteada vai pra `demanda_mensagens` (direção `loja_para_operador`) e marca `demandas_loja.status='respondida'` + `vista_pelo_operador=false`. **Pula completamente bot-lojas/ai-triage.**

## Encerramento

Operador clica "Encerrar demanda" no `DemandaThreadDialog` → `encerrar-demanda-loja`:
- Seta `demandas_loja.status='encerrada'` + `encerrada_at`.
- Envia WA pra loja: *"✅ Demanda DEM-2026-NNNNN encerrada pelo operador. Obrigado! Para nova solicitação, digite menu."* (forçando `evolution_api`).
- Adiciona msg `direcao='sistema'` na thread.
- Reseta `bot_sessoes` ativa do atendimento da loja (próxima mensagem cai no menu corporativo limpo).

Sem encerramento, a demanda fica aberta e a loja continua bypassando o bot — por isso o operador deve sempre encerrar quando o assunto está resolvido.

## Tabelas

- `demandas_loja`: protocolo `DEM-YYYY-NNNNN`, `numero_curto` (sequencial global), `status` (aberta/respondida/encerrada), `vista_pelo_operador`, vincula `atendimento_cliente_id`.
- `demanda_mensagens`: thread privada (operador_para_loja, loja_para_operador, sistema), com `encaminhada_ao_cliente` e `metadata.match_type` (prefix/auto_single/auto_most_recent).

## Edge Functions

- `criar-demanda-loja`: valida modo humano, gera protocolo + número curto, cria/atualiza atendimento da loja com flags `suprimir_ia/bot/atendimento_demanda` e `canal_provedor='evolution_api'`, envia WA formatado pra loja via `send-whatsapp` com `force_provider='evolution_api'`.
- `encaminhar-demanda-cliente`: envia texto editado pelo operador para o atendimento do cliente via `send-whatsapp`, marca mensagens da loja como encaminhadas e adiciona nota sistema.
- `encerrar-demanda-loja`: encerra demanda + notifica loja via WA + reseta bot_sessoes.

## UI

`DemandaLojaPanel` (lista demandas + abre `DemandaThreadDialog`): badges coloridos por status (aberta/respondida/encerrada), contador de não vistas. Thread tem botão "Encerrar demanda" (chama `encerrar-demanda-loja`) e textarea editável pra encaminhar.
