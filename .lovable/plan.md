
## Problema

OCR pode errar para mais ou para menos (ex.: ler -20.50 quando era -2.50). Hoje, quando o grau cai fora da faixa do catálogo, a IA escala direto para humano sem nunca pedir confirmação dos valores ao cliente. E quando dentro da faixa, o flag `receita_confirmacao.pending` existe mas é passivo — o LLM consegue pular a confirmação e cotar/escalar mesmo assim.

## Regra final

1. **Toda receita lida via OCR pede confirmação ao cliente** (independe de estar dentro ou fora da faixa do catálogo).
2. Enquanto `pending=true`, **nenhuma cotação, estimativa, agendamento ou escalada acontece** — IA só repergunta a confirmação.
3. Após o cliente confirmar:
   - Se valores estão **dentro da faixa** → segue fluxo normal (cotar).
   - Se **fora da faixa** → **escala para consultor** com mensagem específica de "grau sob encomenda".
4. Se o cliente corrigir (texto ou nova foto) → volta a `pending=true` com novos valores.

## Mudanças

### 1. `supabase/functions/ai-triage/index.ts`

**a) Helpers** (junto a `buildMsgConfirmarReceita`):
- `isReceitaPending(metadata)` → `metadata.receita_confirmacao?.pending === true`.
- `detectReceitaConfirmacaoCliente(text)` → regex tolerante: `sim`, `isso`, `confere`, `tá certo`, `ok pode`, `correto`, `exato`, `perfeito`, `certinho`, `positivo`, `👍`, `✅`.
- `detectReceitaRejeicaoCliente(text)` → `não`, `tá errado`, `errou`, `não é isso`.
- `isReceitaForaDaFaixa(rx)` → `Math.abs(sphere) > 12 || Math.abs(cyl) > 4 || (rxType==='progressive' && add>3.5)`.
- `MSG_ESCALADA_GRAU_FORA_FAIXA` (constante): "Seu grau é mais alto e exige uma lente sob encomenda. Já chamei um Consultor especializado pra te passar opções e prazo certinho 🤝" (ajustada por horário comercial).

**b) Sucesso de `interpretar_receita` (linhas ~3266-3315 + ramo forced retry ~4084-4114):**
- Sempre que tiver pelo menos OD/OE com sphere lido e não for `explicitOptOut`: marcar `metadata.receita_confirmacao = { pending:true, rx_label, asked_at, correction_count:0, fora_da_faixa: isReceitaForaDaFaixa(rx) }` e responder com `buildMsgConfirmarReceita(rx, false)`.
- Mantém `MSG_PEDIR_RECEITA_TEXTO` apenas para OCR totalmente ilegível (`rxType==='unknown'` sem sphere/cyl).

**c) Pré-LLM gate (após carregar `contato.metadata`, antes de `forcedIntent`/LLM):**
- `isReceitaPending(meta)` + última inbound = confirmação:
  - Limpa `pending=false, confirmed_at=now`. Loga `receita_confirmada_cliente`.
  - Se `meta.receita_confirmacao.fora_da_faixa === true`: envia `MSG_ESCALADA_GRAU_FORA_FAIXA`, marca `precisa_humano=true`, loga `escalada_grau_fora_faixa` com sphere/cyl/rx_type. **Retorna sem LLM.**
  - Caso contrário: segue para LLM normal (que poderá cotar).
- `pending=true` + rejeição: re-envia `buildMsgConfirmarReceita(rx, true)`, `correction_count++`. Se `correction_count>=2`: manda `MSG_PEDIR_RECEITA_TEXTO`. Loga `receita_rejeitada_cliente`. Retorna sem LLM.
- `pending=true` + outra coisa: hint forte ao LLM proibindo `consultar_lentes*` / `agendar_visita` / `escalar` — única ação permitida é `responder` repetindo confirmação. `forcedIntent`/region-trigger ficam downgradados para `responder` enquanto pending.

**d) Defesa em `runConsultarLentes`, `runConsultarLentesContato`, `runConsultarLentesEstimativa`:**
Início da função: ler `contatos.metadata.receita_confirmacao`. Se `pending=true`, retornar `{ resposta: buildMsgConfirmarReceita(rx,false), bloqueado_pendente_confirmacao: true }`. Loga `consultar_lentes_bloqueado_pendente_confirmacao`. Não dispara escalada nem `resposta_fallback`.

**e) Caminho de correção por texto** (`detectPrescriptionCorrection`): hoje aplica e força `consultar_lentes`. Passar a salvar valores novos, marcar `pending=true` (com `fora_da_faixa` recalculado), responder `buildMsgConfirmarReceita(rx, true)`.

### 2. `supabase/functions/watchdog-loop-ia/index.ts`
Exceção: se a última outbound é `buildMsgConfirmarReceita`, NÃO contar como loop nem escalar — repete 1× máximo e segue.

### 3. Memórias
- `mem://ia/auto-receita-e-anti-loop.md`: registrar regra "OCR sempre pede confirmação; fora da faixa só escala APÓS cliente confirmar" + caso Franciana.
- `mem://ia/correcao-receita-por-texto.md`: ajustar para "correção volta a estado pending, não cota direto".

## Eventos novos

- `receita_confirmada_cliente`
- `receita_rejeitada_cliente`
- `consultar_lentes_bloqueado_pendente_confirmacao`
- `escalada_grau_fora_faixa`

## Out of scope

- Cadastrar faixa estendida em `pricing_table_lentes` (operacional).
- NPS/pós-venda.

## Arquivos tocados

- `supabase/functions/ai-triage/index.ts`
- `supabase/functions/watchdog-loop-ia/index.ts`
- `.lovable/memory/ia/auto-receita-e-anti-loop.md`
- `.lovable/memory/ia/correcao-receita-por-texto.md`
