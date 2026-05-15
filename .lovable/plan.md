## Problema

Quando a IA não consegue ler a receita (OCR falhou, ou cliente rejeitou 2x) ela escala para humano (`modo=humano`, motivo `receita_escalada_apos_2_rejeicoes` / `receita_texto_recusada`). O guard logo no início de `ai-triage` (`if (atendimento.modo === "humano") return skipped`) então silencia a IA para sempre — mesmo quando, minutos depois, **o próprio cliente** digita a receita por texto ("Esférico od -0,50 / Esférico OE -2,50"). Hoje isso fica parado aguardando consultor humano abrir, embora a IA já tenha tudo para retomar.

Caso Flávia (15/05): IA escalou às 09:36; cliente digitou OD -0,50 / OE -2,50 às 09:39 e nada mais aconteceu.

## Plano

Adicionar um **pre-router de retomada** em `supabase/functions/ai-triage/index.ts`, posicionado **antes** do `if (atendimento.modo === "humano")` (linha 2275) e depois do parsing básico de `lastInboundText` / `recentOutbound`. Comportamento:

### 1. Gatilho

Detecta TODAS as condições:

- `atendimento.modo === "humano"`
- `metadata.revisao_humana_motivo` ∈ `{ "receita_escalada_apos_2_rejeicoes", "receita_texto_recusada", "rx_ocr_falhou", "rx_invalida" }` (lista whitelist — outros motivos como "consulta_os" continuam intocados)
- `!lastIsImage`
- inbound de texto roda no parser existente `detectPrescriptionCorrection(lastInboundText, /*allowFirst*/true)` e devolve uma receita **válida** (passa em `isReceitaValida`: ao menos um olho com `sphere` ou `cylinder` numérico, `rx_type` ≠ unknown).
- janela máxima desde `escalado_humano_at`: 24h (evita "ressuscitar" atendimento antigo).

### 2. Ação (idempotente, transacional do ponto de vista lógico)

a. **Persistir receita** em `contatos.metadata.receitas[]` como nova entrada `{ source: "client_typed_first_pos_escalada", confirmed_by_client_at: null, ... }` reutilizando o helper de merge já usado no ramo `client_typed_first`. Aplicar mesmo guard anti-hallucination (validação contra `sourceNumbers`).

b. **Marcar `metadata.receita_confirmacao = { pending: true, rx_index, reason: "retomada_pos_escalada", fora_da_faixa }`** (computa fora_da_faixa pelos thresholds atuais).

c. **Devolver atendimento para IA**:
```
atendimentos.update({
  modo: "ia",
  status: "em_andamento",
  metadata: {
    ...meta,
    revisao_humana_pendente: false,
    revisao_humana_motivo: null,
    retomada_ia_pos_escalada_at: now,
    retomada_motivo: "cliente_digitou_receita",
  }
})
```

d. **Mensagem determinística** (sem LLM, anti-alucinação) construída via `buildMsgConfirmarReceita(rx, /*highImpact=*/false)` já existente — pede "A receita é: OD ... / OE ... Confere?". Usa `nomeParaChamar` (já implementado em `resolverNomeExibicao`); se ausente, sem vocativo.

e. Mover card para coluna `Orçamento` (ou manter atual se já estiver lá) — usa o mesmo helper de pipeline_coluna_sugerida.

f. **Eventos**:
- `eventos_crm.tipo = "ia_retomada_pos_escalada_receita_texto"` com `metadata.receita_parsed`, `previous_motivo`, `previous_modo`.
- `audit_log` ou tabela equivalente já usada em escaladas.

g. **Notificar humano** (se já havia atendente atribuído): inserir `notificacoes` "Cliente digitou receita — IA retomou e está aguardando confirmação. Você pode reassumir a qualquer momento" para o `atendente_id` atual. Não escalou a um humano específico = pula.

h. Retorna `jsonResponse({ status:"ok", tools_used:["ia_retomada_pos_escalada_receita"], intencao:"receita_oftalmologica", precisa_humano:false, pipeline_coluna_sugerida:"Orçamento", modo:"ia" })`.

### 3. Fluxo subsequente (já funciona, sem alteração)

- Próximo inbound do cliente ("Sim", "Confere", "Isso") cai no gate `isReceitaPending` (linha 2872), confirma `confirmed_by_client_at`, libera cotação normal via LLM com tool `consultar_lentes`.
- Se cliente corrige ("Na verdade é -0,75…"), entra no ramo `detectPrescriptionCorrection` em modo `client_correction`, com proteção de alto impacto já vigente.
- Se cliente fica em silêncio, o `watchdog-loop-ia` cuida normalmente.

### 4. Guardrails

- **Não retomar** se `metadata.retomada_ia_pos_escalada_at` foi setada nos últimos 10min (evita loop se cliente mandar mais 1 receita logo depois — segunda mensagem já cai no gate).
- **Não retomar** se humano enviou outbound entre `escalado_humano_at` e o inbound atual (consultor já assumiu). Cheque via `atendimentos.outbound_humano_count` ou último `mensagens.author_type === "humano"` posterior à escalada.
- **Não retomar** se `modo === "ponte"` (mensageria interna em curso).
- Mantém compatibilidade com `Modo Homologação Global` (se ativo, ainda persiste receita + evento, mas não envia WhatsApp — já é regra do `sendWhatsApp`).

### 5. Memória

Atualizar/criar `mem://ia/retomada-ia-pos-receita-texto.md` documentando:
- Whitelist de motivos
- Janela 24h
- Idempotência 10min
- Fluxo: persist → pending=true → modo=ia → msg confirmação determinística

Adicionar uma linha em `mem://index.md` (Memories) referenciando o arquivo novo.

### 6. Validação

1. `supabase--curl_edge_functions` POST `/ai-triage` simulando o atendimento da Flávia (modo=humano, motivo=receita_escalada_apos_2_rejeicoes, inbound="Esférico od -0,50 / OE -2,50") → confirmar:
   - `contatos.metadata.receitas[-1].source === "client_typed_first_pos_escalada"`
   - `atendimentos.modo === "ia"`, `revisao_humana_motivo === null`
   - última outbound = "A receita é: OD -0,50 / OE -2,50. Confere?"
2. Re-disparar com inbound "Sim" → cai no gate de confirmação e dispara `consultar_lentes`.
3. Re-disparar inbound de texto banal ("oi tudo bem?") em atendimento humano → continua skipped (parser não devolve receita válida).
4. Re-disparar com motivo `consulta_os` em modo humano → continua skipped (whitelist não inclui).

## Arquivos tocados

- `supabase/functions/ai-triage/index.ts` — novo pre-router antes da linha 2275 (~80 linhas, reutiliza helpers existentes `detectPrescriptionCorrection`, `isReceitaValida`, `buildMsgConfirmarReceita`).
- `.lovable/memory/ia/retomada-ia-pos-receita-texto.md` — novo.
- `.lovable/memory/index.md` — uma linha de referência.

Sem migration. Sem alteração em `whatsapp-webhook` (inbound já dispara `ai-triage` em qualquer modo). Sem alteração de UI.