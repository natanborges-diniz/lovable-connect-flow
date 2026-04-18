

## Diagnóstico

Quando a loja respondeu o teste, a mensagem caiu no `whatsapp-webhook` → como o telefone é corporativo (`telefones_lojas`) e tem demanda aberta, deveria ter sido roteada via `routeDemandaResposta` (memory `canal-demandas-privado.md`). Mas: a loja respondeu **sem prefixo `#NN`**, então caiu no fluxo padrão. Pior: o atendimento da loja foi criado por `criar-demanda-loja` em modo `humano` sem operador → `ai-triage` ou bot-lojas pegou e entrou em loop.

## Causa raiz

1. Loja não sabe/esqueceu de usar `#1` no início da resposta.
2. Mesmo se soubesse, não há **vínculo automático**: enquanto há demanda aberta com aquela loja para um operador, **toda mensagem dela deve ir pra thread da demanda por padrão**, não exigir prefixo.
3. Falta encerramento explícito da demanda → fica aberta pra sempre.
4. Atendimento da loja criado pela demanda fica ativo e a IA/bot-lojas tentam processar mensagens normais.

## Plano

### 1. Auto-roteamento por demanda ativa (sem exigir `#NN`)
Em `whatsapp-webhook`, antes de chamar `bot-lojas`/`ai-triage`:
- Se telefone do remetente é loja corporativa **E** existe `demandas_loja` com `status='aberta'` para essa loja → roteia automaticamente pra thread da demanda mais recente (`direcao='loja_para_operador'`), marca `vista_pelo_operador=false`, **NÃO chama bot-lojas nem IA**.
- Prefixo `#NN` continua suportado pra desambiguar quando a loja tem múltiplas demandas abertas simultâneas.
- Comando `menu` força sair da demanda e abrir bot-lojas normal (escape hatch pra loja acessar pagamentos/boletos sem encerrar a demanda).

### 2. Suprimir IA/bot no atendimento "espelho" da loja
O atendimento criado por `criar-demanda-loja` para a loja serve só pra registrar mensagens WhatsApp. Marcar com flag clara:
- `atendimentos.modo = 'demanda_loja'` (novo modo) OU `metadata.suprimir_ia=true, suprimir_bot=true`.
- `ai-triage` e `bot-lojas` checam essa flag no início e abortam imediatamente.

### 3. Encerramento explícito pelo operador
- Botão **"Encerrar demanda"** no `DemandaThreadDialog` → chama nova EF `encerrar-demanda-loja`:
  - Seta `demandas_loja.status='encerrada'`, `encerrada_at=now()`.
  - Envia WhatsApp pra loja: *"✅ Demanda DEM-2026-00001 encerrada pelo operador. Obrigado! Para nova solicitação, digite menu."*
  - Adiciona msg `direcao='sistema'` na thread.
  - **Após encerrar**, próxima mensagem da loja cai no bot-lojas normal (menu corporativo).

### 4. Auto-encerramento de segurança
Cron diário (ou via `cron_jobs`): demandas `aberta`/`respondida` sem atividade há > 7 dias → auto-encerra com nota sistema. Evita lixo eterno.

### 5. UI: badge de demanda ativa + ação rápida
No `DemandaLojaPanel`:
- Badge "🟢 Aguardando loja" / "🟡 Resposta nova" / "⚪ Encerrada".
- Botão "Encerrar" visível em demandas abertas/respondidas.
- Lista mostra contador de mensagens não vistas.

## Arquivos afetados

- `supabase/functions/whatsapp-webhook/index.ts` — auto-routing por demanda ativa antes de bot/IA.
- `supabase/functions/ai-triage/index.ts` — abort early se `modo='demanda_loja'` ou flag metadata.
- `supabase/functions/bot-lojas/index.ts` — mesmo abort + suporte ao comando `menu` que sai da demanda.
- `supabase/functions/criar-demanda-loja/index.ts` — criar atendimento da loja já com `modo='demanda_loja'` ou flag de supressão.
- `supabase/functions/encerrar-demanda-loja/index.ts` — **nova**: encerra demanda + WA pra loja + nota sistema.
- `src/components/atendimentos/DemandaLojaPanel.tsx` + `DemandaThreadDialog.tsx` — botão Encerrar + badges de status.
- Migration: adicionar valor `'demanda_loja'` ao check de `atendimentos.modo` (se for enum/check), ou só usar `metadata.suprimir_ia`. **Prefiro `metadata.suprimir_ia=true` + `metadata.suprimir_bot=true`** — sem migration de schema, mais flexível.
- Memory update: `mem://bot-lojas/canal-demandas-privado.md` — documentar auto-routing sem prefixo + encerramento explícito.

## Fluxo final

```text
Operador "Solicitar à loja"
  → criar-demanda-loja (atendimento loja com suprimir_ia/bot=true)
  → WA pra loja com pergunta + instrução opcional #NN

Loja responde qualquer coisa
  → webhook detecta demanda aberta → vai pra thread (NÃO chama IA/bot)
  → operador vê resposta, edita, "Encaminhar ao cliente"

Operador clica "Encerrar demanda"
  → encerrar-demanda-loja → WA confirma → status=encerrada

Próxima msg da loja (sem demanda ativa)
  → bot-lojas normal (menu corporativo)
```

