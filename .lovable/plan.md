## Princípio: reaproveitar o que já existe

Antes de criar qualquer tabela, mapeei o que já está no banco e nas edge functions. Resultado: **a maior parte do trabalho cabe em colunas/JSONB existentes**. Só criamos estrutura nova onde não há substituto.

| Necessidade | Onde já existe (reaproveitar) | Falta criar |
|---|---|---|
| Status do telefone (validado / pessoa_errada / inválido / sem_resposta) | `canais` (1 linha por WhatsApp do contato) — usar `canais.metadata` + colunas novas | só ALTER em `canais` |
| Trilha de interações (enviado / entregue / lido / respondido / falhou) | `eventos_crm` (append-only, já indexado por contato) | só padronizar `tipo` |
| Status por mensagem individual | `mensagens.metadata` jsonb | nada |
| Status por touchpoint da régua | `regua_touchpoint.status_entrega` (já existe) | nada |
| Aceite LGPD do cashback | `regua_inscricao.consentimento_status`, `consentimento_at`, `canal_consentimento` (já existem) | só ALTER p/ versão dos termos |
| PIN do cashback | nada | ALTER em `regua_inscricao` |
| Webhook de status Meta | `whatsapp-webhook` (hoje só trata `messages`, não trata `statuses`) | adicionar ramo |
| Envio de template / texto | `send-whatsapp-template`, `send-whatsapp` | hookar grava\u00e7\u00e3o em `eventos_crm` |
| Cashback (gerar/confirmar PIN) | `cashback-loja` (tem `action: consultar` / `registrar`) | adicionar `action: gerar_pin` e `confirmar_pin` |

**Resultado: zero tabelas novas.** Apenas ALTERs e ramos em funções já existentes.

---

## Parte 1 — PIN + LGPD no cashback (reuso de `cashback-loja` + `regua_inscricao`)

### ALTER em `regua_inscricao`

```sql
ALTER TABLE regua_inscricao
  ADD COLUMN pin_hash text,
  ADD COLUMN pin_expira_at timestamptz,
  ADD COLUMN pin_tentativas smallint NOT NULL DEFAULT 0,
  ADD COLUMN pin_confirmado_at timestamptz,
  ADD COLUMN termos_versao text,
  ADD COLUMN ip_origem_consultor inet;
```

Reusa `consentimento_status` / `consentimento_at` / `canal_consentimento` que **já existem** — só passamos a preenchê-los (`canal_consentimento='pin_whatsapp'`).

### Edge function `cashback-loja` (já existe) ganha 2 ações

- `action: "gerar_pin"` — gera PIN 4 dígitos, grava `pin_hash` (sha256), `pin_expira_at = now()+15min`, dispara template WhatsApp. **Não grava resgate ainda.**
- `action: "confirmar_pin"` — valida PIN, incrementa `pin_tentativas`, em sucesso seta `pin_confirmado_at`, `consentimento_status='aceito'`, `consentimento_at=now()`, `termos_versao`, e atualiza `canais` do contato (ver Parte 3) marcando telefone como `validado`.
- `action: "registrar"` (já existe) — passa a **exigir `pin_confirmado_at IS NOT NULL`** antes de chamar a RPC. Sem PIN, recusa.

### Template WhatsApp (rascunho UTILITY, marca Óticas Diniz)

```text
Olá, {{1}} 👋
Para concluir seu cashback na Óticas Diniz, informe ao consultor o código:

🔐 *{{2}}*  (válido por 15 min)

Ao informar o código você confirma este número como canal oficial e aceita
nossos termos e LGPD: {{3}}

Se não foi você quem comprou, responda *NÃO FUI EU*.
```

Parâmetros: `{{1}}`=primeiro nome · `{{2}}`=PIN · `{{3}}`=link `https://atrium-link.lovable.app/termos/cashback?ins=<id>`.

### Página pública `/termos/cashback`

Nova rota `src/pages/TermosCashback.tsx` (sem login, sem checkbox extra — o aceite material é a digitação do PIN). Mostra o texto vigente + versão + link para PDF arquivado. Mantém auditabilidade.

### Frontend `ReguaNovaVenda.tsx`

Adicionar passo intermediário: depois de "Lançar" o consultor vê input "Confirmar PIN do cliente" (4 dígitos) + botões "Reenviar PIN" / "Cancelar". "Concluir" só fica ativo após confirmação.

---

## Parte 2 — Confirmação de cliente para contatos não-validados (template + botões)

**Sem mudança de schema.** Apenas garantir que todo template iniciador de jornada (régua, recuperação, agendamento) verifica `canais.metadata->>'status'` antes de enviar:

- Se `validado` → segue fluxo normal.
- Se `nao_validado` (default) → envia **primeiro** um template `confirmar_titular` com botões quick-reply:
  - `Sim, sou eu` → webhook marca canal como `validado` (canal_consentimento=`botao_template`).
  - `Não fui eu` → marca como `pessoa_errada`, cancela jornada, cria demanda Atrium para a loja reabordar.
  - `Outro nome` → escala para humano/IA.

Rascunho de template em `whatsapp_templates` (status `draft` até aprovar na Meta).

---

## Parte 3 — Status do telefone em `canais` (reuso)

Hoje `canais` já guarda 1 linha por WhatsApp do contato, com `metadata jsonb`. Padronizamos:

```sql
ALTER TABLE canais
  ADD COLUMN status text NOT NULL DEFAULT 'nao_validado',
  ADD COLUMN validado_at timestamptz,
  ADD COLUMN canal_consentimento text,         -- 'pin_whatsapp' | 'botao_template' | 'manual_loja'
  ADD COLUMN termos_versao text,
  ADD COLUMN ultimo_motivo_falha text,         -- 'numero_invalido' | 'entrega_falhou' | 'sem_leitura' | 'lido_sem_resposta' | 'pessoa_errada'
  ADD COLUMN ultima_falha_at timestamptz,
  ADD COLUMN tentativas_enviadas int NOT NULL DEFAULT 0,
  ADD COLUMN tentativas_entregues int NOT NULL DEFAULT 0,
  ADD COLUMN tentativas_lidas int NOT NULL DEFAULT 0,
  ADD COLUMN tentativas_respondidas int NOT NULL DEFAULT 0;
ALTER TABLE canais ADD CONSTRAINT canais_status_chk
  CHECK (status IN ('nao_validado','validado','pessoa_errada','invalido','sem_resposta'));
```

Vantagem: já existe FK para `contatos`, RLS, índices, e suporta múltiplos canais (WhatsApp pessoal, comercial, etc.) sem mistura.

---

## Parte 4 — Telemetria de efetividade (reuso de `eventos_crm`)

`eventos_crm` já é append-only com `contato_id`, `tipo`, `metadata jsonb`, `referencia_tipo`, `referencia_id`. **Não precisa de tabela nova.** Apenas padronizar os tipos:

| tipo | quando grava | quem grava |
|---|---|---|
| `contato_enviado` | mensagem saiu | `send-whatsapp` / `send-whatsapp-template` |
| `contato_entregue` | Meta callback `delivered` | `whatsapp-webhook` (ramo novo `statuses`) |
| `contato_lido` | Meta callback `read` | `whatsapp-webhook` |
| `contato_respondido` | inbound chegou | `whatsapp-webhook` (já existe — só emitir o evento) |
| `contato_falhou` | Meta callback `failed` ou `errors` | `whatsapp-webhook` |
| `contato_pessoa_errada` | botão "Não fui eu" / resposta `NÃO FUI EU` | `whatsapp-webhook` |
| `contato_sem_resposta` | sem resposta após N horas | novo cron (ver abaixo) |

Cada gravação **também incrementa o contador certo em `canais`** e atualiza `ultimo_motivo_falha` / `status` quando aplicável.

### `whatsapp-webhook` ganha ramo `statuses`

Hoje a função só processa `messages`. Adicionar bloco que processa `entry[].changes[].value.statuses[]` (campos `status`, `recipient_id`, `errors`) → grava em `eventos_crm` + atualiza `canais` + atualiza `mensagens.metadata.last_status`.

### Único cron novo: `contato-sem-resposta-cron`

Roda 1x/hora. Para mensagens com `contato_entregue` (ou `contato_lido`) há mais de N horas sem `contato_respondido` na mesma referência, grava `contato_sem_resposta` com `motivo='sem_leitura'` ou `'lido_sem_resposta'`. N configurável em `cron_jobs.payload.thresholds` (padrão editável da memória).

---

## Parte 5 — Dashboard "Saúde do contato"

Nova aba dentro de `Dashboard.tsx` (não cria página). Consulta agregada sobre `canais` + `eventos_crm`:

- KPI: `% telefones validados`.
- Funil: enviados → entregues → lidos → respondidos (últimos 30 dias).
- Pizza: motivos de falha.
- Tabela paginada de contatos com `status != validado` ou `ultimo_motivo_falha` recente, com ações: "Reenviar validação", "Marcar inválido manualmente", "Transferir p/ loja reabordar" (gera demanda Atrium).

Hook novo: `src/hooks/useContatoTelemetria.ts`.

---

## Memória do projeto

- Atualizar `mem://index.md` Core com regra: *"Telefone só é canal oficial após `canais.status='validado'`. Cashback exige PIN confirmado para registrar. `pessoa_errada` só por ação explícita do receptor."*
- Criar `mem://contatos/validacao-pin-lgpd-cashback.md` (fluxo, tabela, edge functions).
- Criar `mem://contatos/telemetria-canais-eventos-crm.md` (mapeamento dos `eventos_crm.tipo`, ramo `statuses` do webhook, contadores em `canais`).

---

## O que NÃO criamos (anti-lixo)

- ❌ Tabela `contato_telefone_status` — substituída por colunas em `canais`.
- ❌ Tabela `contato_interacoes` — substituída por `eventos_crm` (já apropriada).
- ❌ Tabela `cashback_pin` — substituída por colunas em `regua_inscricao`.
- ❌ Edge function `marcar-contato-falha` — `whatsapp-webhook` já recebe o evento; um único caminho.
- ❌ Página separada de PIN para o cliente — PIN vai no corpo da mensagem mesmo.

## Fora de escopo

- Campanha massiva de re-validação da base legada (faremos em fase 2).
- Métrica financeira (ROI validado vs não validado).
- Integração com DPO/contratos externos.
