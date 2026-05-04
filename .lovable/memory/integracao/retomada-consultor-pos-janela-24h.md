---
name: Retomada do consultor após janela de 24h fechada
description: Template UTILITY retomada_consultor_v1 + AlertDialog automático no erro 422 outside_24h_window que pré-seleciona o template e preserva o rascunho
type: feature
---

## Cenário
Atendimento foi para humano, o consultor não conseguiu responder dentro das 24h da Meta, e a janela fechou. Tentativa de enviar texto livre via `send-whatsapp` retorna `422 { error: "outside_24h_window", hours_since_last_inbound }`.

## Comportamento implementado

1. **`Atendimentos.tsx > AtendimentoDetail.handleSend`**
   - Detecta `outside_24h_window` no body de erro do `send-whatsapp` (lendo `error.context.body` ou `data` direto).
   - Abre `JanelaFechadaDialog` com horas desde último inbound.
   - **Não limpa `msgText`** — o texto livre que o consultor tentou enviar fica preservado no input pra ele reenviar quando o cliente responder "oi".

2. **`JanelaFechadaDialog`**
   - Explica a janela fechada e o pedido de desculpas que será enviado.
   - 3 ações: "Enviar retomada" (pré-seleciona `retomada_consultor_v1`), "Escolher outro template", "Cancelar".

3. **`ReconectarTemplateButton`** ganhou props:
   - `defaultTemplate`: template a pré-selecionar.
   - `open`/`onOpenChange`: controle externo do popover.
   - `forceVisible`: ignora gate de 24h quando aberto via 422.
   - `consultorNome`: pré-preenche `{{2}}` (nome do consultor) para templates `retomada_consultor*`.
   - `hideTrigger`: opcional, esconde o botão.
   - Lista `PRIORIDADE` agora inicia com `retomada_consultor_v1` / `retomada_consultor`.

## Template

Catálogo (`whatsapp_templates`) + alias (`retomada_consultor` → `retomada_consultor_v1`).

- **Nome:** `retomada_consultor_v1`
- **Categoria:** UTILITY (continuidade de atendimento iniciado pelo cliente — cabe em UTILITY pelos mesmos critérios do `noshow_reagendamento_v2` / `retomada_contexto_*_v2`).
- **Idioma:** pt_BR
- **Variáveis:** `{{1}}` nome do cliente · `{{2}}` primeiro nome do consultor (fallback "consultor das Óticas Diniz" via `useAuth().profile.nome`).
- **Body:**
  ```
  Oi {{1}}, aqui é {{2}}, das Óticas Diniz. Desculpa não ter conseguido te responder antes — a falha foi nossa. Posso seguir seu atendimento por aqui agora? É só me mandar um "oi" que já te respondo.
  ```
- **Status Meta:** PENDING (submetido via `manage-whatsapp-templates` action `create`, id `1441162264000431`).

## Regras
- Disparo é **100% manual**. O sistema só **prepara** a ação no momento do erro 422.
- Sem cron automático.
- Assina "Óticas Diniz" (regra `branding-cliente-final`); "Atrium" nunca aparece.
- Pode ser repointado via alias `retomada_consultor` quando uma versão `_v2` for aprovada.
