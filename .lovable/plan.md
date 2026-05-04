
# Plano — OCR robusto + Retomada cordial pós-janela 24h (consultor humano)

## Bloco 1 — Interpretação de receita (sem mudança vs. plano anterior)

Resumo: limiar OCR mais conservador (≥0.85), pedido por olho específico quando parcial, conciliar OCR+texto antes de orçar, aceitar digitação espontânea, escalar humano só por improdutividade real (2× sem resposta interpretável, loop pós-pedido, cliente pediu, ou zero opções com receita conciliada). Watchdog força pedido por texto se imagem >30min sem receita válida.

Arquivos: `ai-triage/index.ts`, `watchdog-loop-ia/index.ts`, memórias `auto-receita-e-anti-loop` e `correcao-receita-por-texto`.

---

## Bloco 2 — Template `retomada_consultor_v1` + ação manual no erro 422

### Cenário (corrigido)
Atendimento foi para humano, **o consultor não conseguiu falar dentro das 24h**, a janela Meta fechou. Hoje, quando o consultor tenta enviar texto livre, `send-whatsapp` devolve `422 outside_24h_window` (vide print). O consultor não tem caminho fácil pra reabrir — precisa lembrar de abrir o `ReconectarTemplateButton` e escolher um template no meio da lista.

### Template — UTILITY, cordial, natural, sem "explicar o retorno"

**Nome:** `retomada_consultor_v1`  
**Categoria:** **UTILITY** (continuidade de atendimento iniciado pelo cliente — não é promoção; é a categoria mais barata e correta semanticamente; o catálogo já documenta `noshow_reagendamento_v2` e `retomada_contexto_*_v2` como UTILITY pelo mesmo motivo).  
**Idioma:** pt_BR  
**Variáveis:** `{{1}}` nome do cliente · `{{2}}` nome do consultor

**Body (versão única, sem variável de "assunto"):**
```
Oi {{1}}, aqui é {{2}}, das Óticas Diniz. Desculpa não ter conseguido te responder antes — a falha foi nossa. Posso seguir seu atendimento por aqui agora? É só me mandar um "oi" que já te respondo.
```

Por que ficou assim:
- Sem `{{2}}` de "assunto" — o cliente lembra do que estava falando, não precisa ser relembrado e isso evita texto travado tipo "sobre seu orçamento de lentes multifocais".
- Pedido de desculpas explícito ("a falha foi nossa") — assume a responsabilidade.
- "{{2}}" agora é o **nome do consultor**, dá rosto humano à mensagem.
- "É só me mandar um oi" — CTA leve, reabre janela de 24h sem cobrança.
- Assina "Óticas Diniz" (regra `branding-cliente-final`).
- UTILITY tem chance maior de aprovação Meta com esse tom (sem CTA promocional, sem oferta).

### Disparo manual disparado pelo erro 422 (novo fluxo)

Hoje: erro `outside_24h_window` aparece como toast vermelho cru no chat (vide print) e o consultor precisa adivinhar o próximo passo.

Proposta:

1. **`useAtendimentos` / handler de envio** — detectar resposta `422` com `error === "outside_24h_window"` do `send-whatsapp`. Em vez de só toast de erro, abrir um `AlertDialog` com:
   - Título: "Janela de 24h fechada"
   - Texto: "Faz {{N}}h que o cliente não responde. Pra reabrir o atendimento, envie o template de retomada — você pode editar antes."
   - Botão primário: **"Enviar retomada"** → abre `ReconectarTemplateButton` já com `retomada_consultor_v1` pré-selecionado e `{{1}}` = nome do contato, `{{2}}` = nome do consultor logado (de `profiles.nome`).
   - Botão secundário: "Escolher outro template" → comportamento atual.
   - Botão terciário: "Cancelar".

2. **`ReconectarTemplateButton.tsx`** — aceitar prop `defaultTemplate` e `prefilledVars`; quando vier do diálogo do 422, pular a etapa de seleção e ir direto pro preview com o texto montado. `retomada_consultor_v1` entra no topo da constante `PRIORIDADE`.

3. **Texto que o consultor estava tentando enviar** — preservar como rascunho no input após reabertura, pra ele reenviar livremente assim que o cliente responder "oi". Hoje o texto se perde quando dá 422.

4. **Log** — após envio bem-sucedido, gravar `eventos_crm` tipo `retomada_consultor_manual` com `template_nome`, `atendente_nome`, `texto_rascunho_preservado` (boolean), e `horas_desde_ultimo_inbound`.

5. **Sem cron automático** — disparo é 100% manual (intencional: o consultor decide quando reabrir; o sistema só **prepara** a ação no momento do erro).

### Arquivos tocados (Bloco 2)

- `supabase/functions/manage-whatsapp-templates/index.ts` — submeter `retomada_consultor_v1` UTILITY à Meta via action `create`
- Migration: `INSERT` em `whatsapp_templates` (status `pending` até Meta aprovar) + alias `retomada_consultor` em `template_aliases`
- `src/components/atendimentos/ReconectarTemplateButton.tsx` — props `defaultTemplate`/`prefilledVars`, prioridade
- `src/hooks/useAtendimentos.ts` (ou local equivalente do `send-whatsapp` no chat) — interceptar 422 `outside_24h_window`
- Novo: `src/components/atendimentos/JanelaFechadaDialog.tsx` — AlertDialog descrito acima
- Memória nova: `mem://integracao/retomada-consultor-pos-janela-24h`

### A confirmar antes de submeter à Meta

1. Body acima OK ou prefere ainda mais curto/longo?
2. `{{2}}` = primeiro nome do consultor (ex.: "Marina") ou nome completo?
3. Quando o consultor não tem nome em `profiles.nome`, fallback para "consultor das Óticas Diniz" — ok?
