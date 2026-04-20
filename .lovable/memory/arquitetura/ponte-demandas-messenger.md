---
name: Ponte de demandas via Messenger
description: Convenção conversa_id='demanda_<id>' espelha mensagens_internas → demanda_mensagens via trigger + bridge-demanda. Comandos /encerrar fecham pela loja.
type: feature
---

## Convenção de conversa
- Toda demanda abre uma conversa única no Messenger com `conversa_id = 'demanda_' || demanda.id`.
- `criar-demanda-loja` faz broadcast (uma linha por destinatário em `mensagens_internas`, mesma `conversa_id`) para cada usuário interno vinculado à loja (via `resolver_destinatarios_loja`).
- A primeira mensagem da loja é gravada **direto em `demanda_mensagens`** com `metadata.bootstrap=true`. As cópias em `mensagens_internas` são detectadas pela bridge (heurística: contém o protocolo + a pergunta) e **ignoradas** para não duplicar.

## Bridge (`bridge-demanda` edge function)
- Disparada pelo trigger `trg_mensagem_interna_demanda` (AFTER INSERT em `mensagens_internas` quando `conversa_id LIKE 'demanda_%'`).
- Resolve direção: `remetente_id == demanda.solicitante_id` → `operador_para_loja`; senão → `loja_para_operador`.
- Anti-loop: dedup por `metadata.origin_msg_id = mensagem_interna_id` antes de inserir em `demanda_mensagens`.
- Quando vier da loja: atualiza `demandas_loja.status='respondida'`, `ultima_mensagem_loja_at`, `vista_pelo_operador=false` e cria `notificacoes` para o solicitante.
- Comandos textuais da loja: `/encerrar`, `/resolvido`, `/fechar` → chama `encerrar-demanda-loja` com `X-Internal-Caller` + `encerrado_por='loja'`.

## Painel operador
- `DemandaLojaPanel` continua lendo `demanda_mensagens` via Realtime — sem mudança de UI fora o badge "via Messenger".
- `NovaDemandaDialog` mostra contagem ao vivo de destinatários internos (`resolver_destinatarios_loja`); alerta vermelho quando 0.

## Anexos
- Loja envia anexo via Companion → `mensagens_internas.anexo_url` (bucket público `mensagens-anexos`) → bridge copia para `demanda_mensagens.anexo_url`/`anexo_mime`.
