---
name: Silêncio pós-agendamento + despedida determinística + auto-persistência
description: Após confirmação de agendamento, IA se despede determinística e silencia até cliente trazer novo intent. Detector pós-LLM persiste agendamento se IA prometeu sem disparar tool.
type: feature
---

## Despedida determinística (ai-triage/index.ts ~2290)

`isThanksClose | isShortNoToHelp | isExplicitClose` → string montada em código (sem LLM) e enviada via `sendWhatsApp`, `return jsonResponse` antes do LLM. Usa exclusivamente `agendamentoFmt` da tabela `agendamentos`. Se vazio, despedida sem data — proibido alucinar.

Anti-dup: se último outbound já contém despedida canônica + 👋, silencia (`evento despedida_duplicada_evitada`).

## Silêncio pós-agendamento (ai-triage/index.ts ~2333)

Quando `hasAgendamentoAtivo && último outbound é despedida canônica`:
- Cliente sem novo intent (sem `?`, sem palavras-chave de preço/produto/remarcar/endereço/horário/foto) → **silêncio total** (`evento pos_agendamento_silencio`).
- Com novo intent → fluxo normal segue.

Palavras-chave que quebram silêncio: preço/valor/orçamento, remarcar/reagendar/cancelar/mudar/trocar, endereço/como chego, horário/abre/fecha, receita/foto/imagem/grau, marcas (Ray-Ban, Oakley, Varilux, Zeiss, Hoya etc.).

## Detector pós-LLM auto-persistência (ai-triage/index.ts ~3954)

Após `sendWhatsApp` final, se `toolCalls` não inclui agendar_visita/reagendar_visita MAS `resposta` contém promessa (`agendamento confirmado|te esperamos|ficou (re)agendado|marquei pra você` etc.) + extrai data DD/MM + hora HH(h|:)MM + match de loja em `telefones_lojas`, dispara `agendar-cliente` em background (fire-and-forget). Idempotente: pula se já existe linha em `agendamentos` para mesma loja+data. Log: `eventos_crm.tipo='agendamento_auto_persistido'`.

## Router armações com guardrail (ai-triage/index.ts ~1788)

Movido para depois das queries paralelas. Se há agendamento ativo, NÃO oferece lojas — reafirma com `Já está tudo certo, {nome}! Te espero {data} às {hora} na {loja} — vou separar modelos pra você provar lá no balcão 😉`.

## Regras estritas no prompt do LLM (ai-triage/index.ts ~2702)

System message universal:
1. Proibido citar data/loja fora de AGENDAMENTOS DESTE CLIENTE.
2. Confirmar visita = chamar tool agendar_visita ANTES de prometer.
3. Proibido reescrever data com base no histórico.
4. Após despedida, não emendar perguntas.
