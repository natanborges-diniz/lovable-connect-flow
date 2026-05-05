
## Contexto

As lojas operam **exclusivamente** pelo InFoco Messenger (Atrium Messenger). Este projeto (Atrium-Link) só envia para o Messenger via `notificacoes` + push e via ações em `agendamentos`. Os bugs/buracos identificados:

1. Aviso de novo agendamento à loja só dispara quando o cliente confirma um lembrete dia-D. Quando o Gael agenda direto na conversa, a loja **não recebe nada**.
2. `agendamentos-cron` quebra com `ReferenceError: SERVICE_KEY is not defined` no bloco G — interrompe recuperação, despedida e abandono.
3. Lembrete pode disparar 2x (véspera 08h + 1h antes) sem checar deduplicação cruzada.
4. Não existe forma fácil, dentro do Atrium-Link, de auditar a evidência da conversa cliente × IA × cron.
5. A loja recebe avisos mas não responde — não há cobrança ativa de comparecimento/no-show/venda fechada com botões diretos no card de notificação no Messenger.

---

## Itens da correção (escopo aprovado: 1, 2, 3, 5 + nova régua de cobrança ativa)

### 1) Aviso à loja no momento do agendamento (Messenger)

- Em `supabase/functions/agendar-cliente/index.ts`, após `INSERT` bem-sucedido em `agendamentos`, invocar `notificar-loja-agendamento` em background (mesmo padrão já usado em `ai-triage` e `whatsapp-webhook`).
- A EF `notificar-loja-agendamento` já é idempotente via `metadata.aviso_loja_enviado_at`, então invocações redundantes (no agendamento + na confirmação dia-D) não duplicam.
- Ajustar título/mensagem para deixar claro o estado: "📅 Novo agendamento — {cliente}" no momento do agendar; "✅ Cliente confirmou — {cliente}" no dia-D (passar um parâmetro `evento: "novo" | "confirmado"`).

### 2) Corrigir `agendamentos-cron` (SERVICE_KEY)

- Linha 155 (bloco G) usa `SERVICE_KEY` fora do escopo. Trocar por `SUPABASE_SERVICE_ROLE_KEY` (já declarada no `serve()`).
- Auditar todas as helpers (`processLembreteVespera`, `processLembrete1hAntes`, `processFirstStoreCharge`, `processSecondStoreChargeNextMorning`) e padronizar o nome do parâmetro como `SERVICE_KEY` na assinatura mas passar `SUPABASE_SERVICE_ROLE_KEY` no call site — como já é feito.
- Adicionar `try/catch` por bloco (A→G) para que falha em um não interrompa os demais.

### 3) Deduplicação do lembrete

Em `agendamentos-cron`, antes de disparar o lembrete 1h-antes:
- Pular se `tentativas_lembrete >= 1` **e** `metadata.lembrete_vespera_at` existe.
- Pular se `data_horario - now < 60 min` (antecedência insuficiente).
- Pular se `metadata.cliente_confirmou_at` existe (regra de memória já estabelecida).
- Marcar `metadata.lembrete_1h_at` ao enviar para auditoria cruzada.

### 5) Nova régua de cobrança ativa da loja no Messenger

Hoje a loja recebe `notificacoes` informativas mas precisa entrar em `LojaAgenda.tsx` para agir. Vamos transformar cada cobrança em **ação direta no Messenger**:

**Backend (Atrium-Link):**

- Nova EF `loja-acao-agendamento` (`verify_jwt = true`) que aceita `{ agendamento_id, acao: "compareceu" | "noshow" | "venda_fechada", payload? }` vindo do Messenger autenticado. Ela:
  - Atualiza `agendamentos.status` e `loja_confirmou_presenca` conforme ação.
  - Insere `eventos_crm` apropriado (`loja_confirmou_comparecimento` / `loja_marcou_noshow` / `venda_fechada`).
  - Para `venda_fechada`, persiste `valor_venda`, `numero_venda`, `numeros_os[]`.
  - Garante idempotência (checa status atual antes de mutar).

- Reformular o conteúdo das notificações de cobrança (`processFirstStoreCharge` e `processSecondStoreChargeNextMorning`):
  - Tipo passa a ser `cobranca_comparecimento_loja`.
  - `metadata` da `notificacoes` carrega `agendamento_id` + `acoes_disponiveis: ["compareceu","noshow","venda_fechada"]`.

- Após `loja_silenciou` (timeout 48h), em vez de só virar `no_show`, criar **tarefa de alta prioridade no setor da loja** com checklist:
  - "Ligar para cliente"
  - "Atualizar status manualmente (compareceu / no-show)"
  - "Registrar motivo do no-show".

**Frontend (InFoco Messenger — projeto cross):**

Mudanças no projeto `InFoco Messenger` (precisa rodar lá; será feita após aprovação deste plano voltando àquele projeto):

- Em `NotificacoesList.tsx`, quando `tipo === "agendamento_confirmado_loja"` ou `cobranca_comparecimento_loja`, renderizar um **card de ação** com 3 botões:
  - ✅ "Cliente compareceu" → chama `loja-acao-agendamento` com `acao=compareceu`.
  - ❌ "Não compareceu (no-show)" → `acao=noshow`.
  - 💰 "Venda fechada" → abre dialog (valor, número da venda, OS) e chama `acao=venda_fechada`.
- Ao acionar, marca a notificação como lida + mostra toast + atualiza realtime em `agendamentos`.
- Em `LojaAgenda.tsx`, no card do dia, exibir badge "🔔 Aguardando confirmação" para agendamentos com cobrança ativa, ligando ao mesmo dialog.

### Régua reforçada

```text
T0  Agendamento criado    → push "Novo agendamento" + card no Messenger
T-1d 08h SP                → lembrete cliente (1x)
T-1h                        → lembrete cliente (se não enviado e ≥60min)
T+2h sem status loja       → 1ª cobrança ativa (3 botões no Messenger)
T+1d 10h SP sem resposta   → 2ª cobrança ativa
T+48h sem resposta         → tarefa supervisor + status no_show automático
T+24h pós no_show          → IA tenta cliente (cadência 3x/72h)
```

---

## Itens fora deste plano

- **Item 4 (visualização do diálogo cliente × IA × cron)** — você pediu para deixar fora desta rodada. Quando quiser, adicionamos um filtro "Atividade de IA/Sistema" na tela de Atendimentos com um toggle no header.

---

## Arquivos afetados

**Atrium-Link (este projeto):**
- `supabase/functions/agendar-cliente/index.ts` — invocar `notificar-loja-agendamento` no insert + passar `evento: "novo"`.
- `supabase/functions/notificar-loja-agendamento/index.ts` — aceitar `evento` para variar título/copy.
- `supabase/functions/agendamentos-cron/index.ts` — fix `SERVICE_KEY`, dedup lembrete, try/catch por bloco, payload de cobrança com `acoes_disponiveis`, tarefa no timeout.
- `supabase/functions/loja-acao-agendamento/index.ts` (NOVA) — endpoint autenticado para a loja agir.
- `supabase/config.toml` — registrar a nova função (sem override; padrão `verify_jwt = true`).

**InFoco Messenger (projeto cross — fica para a próxima rodada lá):**
- `src/pages/NotificacoesList.tsx` — card de ação com 3 botões.
- `src/pages/LojaAgenda.tsx` — badge "Aguardando confirmação" + dialog de venda fechada.
- Hook novo `useAcaoAgendamento.ts` chamando a EF.

## Memórias a atualizar
- `mem://agendamentos/cadencia-noshow-e-cobranca-loja.md` — incluir fluxo dos 3 botões e EF `loja-acao-agendamento`.
- `mem://agendamentos/aviso-loja-pos-confirmacao.md` — registrar que dispara também no momento do agendamento (evento "novo").

Pode aprovar que eu começo pelos itens do Atrium-Link (1, 2, 3 e backend do 5). Depois eu volto ao **InFoco Messenger** e implemento o frontend dos 3 botões.
