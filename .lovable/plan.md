# Copiloto de Cotação de Lentes no Chat (uso humano)

## Premissas
- **Fluxo automático da IA não muda.** `runConsultarLentes`, `runConsultarLentesEstimativa` e `runConsultarLentesContato` em `ai-triage` continuam intactos.
- O painel aparece em **todo atendimento** aberto (inclusive os que seguem só na IA), como ferramenta do operador para conferir/complementar/preparar resposta.
- O texto final montado pelo painel sai **na mesma linguagem do Gael / Óticas Diniz** já usada pela IA — mesmas faixas 🟢🟡💎, mesmas regras de marca, mesmo tom curto e consultivo.

## UX no chat (`/atendimentos`)

Botão **🔍 Buscar lentes** no header do painel de conversa, ao lado do `ReceitaValidacaoPopover`. Sempre visível quando há atendimento aberto, independente do modo (IA, humano, ponte).

Abre **Sheet lateral** (~520px) com 3 abas:

1. **Óculos (visão simples / multifocal)**
   - Receita pré-carregada de `atendimento.metadata.receitas[ultimo]` com OD/OE/ADD editáveis inline (override só da consulta, **não persiste**).
   - Toggle multifocal / visão simples (auto-detectado por ADD).
   - Chips de filtro: marca preferida, antirreflexo (Crizal/blue/Prevencia), material (policarbonato / 3 peças), photo.
   - Campo "instrução em linguagem natural" (ex.: "Varilux pra 3 peças com Crizal Sapphire").

2. **Lentes de contato**
   - Mesma receita; toggle tórica (auto se |cyl|≥0.75).
   - Filtros: descarte (diária/quinzenal/mensal), marca, uso (natação, etc).

3. **Estimativa / Catálogo livre**
   - Quando não tem receita ou cliente só passou esférico+tipo.
   - Busca estruturada direta no catálogo (marca, faixa de preço, tratamento) sem LLM — atende perguntas avulsas tipo "vocês têm Zeiss Drivesafe?".

### Resultados

- 3 faixas **🟢 Econômica / 🟡 Intermediária / 💎 Premium** no mesmo formato visual da IA.
- Cada linha: marca · família · tratamento · **R$ valor** · badges (DNZ, 3 peças OK, sob encomenda, Kodak→escala humano).
- Validador anti-inversão (Eco ≤ Inter ≤ Prem) já aplicado.
- Bloco **"Mensagem pronta"** abaixo, no tom Gael / Óticas Diniz, igual ao que a IA enviaria. Dois botões:
  - **📋 Copiar**
  - **✍️ Inserir no composer** — preenche o campo de mensagem do chat; operador revisa e envia normalmente (sem auto-envio).
- Botão **Ver alternativas** abre lista plana ordenada por preço puro ou filtrada por marca.

## Backend

Nova edge function **`buscar-lentes-operador`** (`verify_jwt = true`):

- Input: `{ atendimento_id, modo: "oculos" | "lc" | "estimativa" | "catalogo_livre", query_natural?, filtros?, receita_override? }`.
- Resolve receita: `receita_override` > `metadata.receitas[ultimo]` > vazio.
- `query_natural`: 1 chamada Lovable AI Gateway (`google/gemini-3-flash-preview`, temp 0) com tool calling restrito às mesmas três tools que a IA usa — só pra escolher tool e extrair filtros. A EF executa localmente.
- `catalogo_livre`: SQL direto em `pricing_table_lentes` / `pricing_lentes_contato`.
- **Reaproveita** a lógica dos três `runConsultarLentes*` extraindo para `supabase/functions/_shared/lentes-engine.ts`. `ai-triage` passa a importar do shared (refator puro, **zero mudança de comportamento da IA**) e a nova EF também importa.
- Síntese da mensagem final usa as mesmas funções `buildMsgCotacao…` que a IA já tem em `_shared/mensagens-gael.ts` (extrair se ainda inline) — garante mesma linguagem.
- Output: `{ faixas, alternativas, mensagem_formatada_cliente, debug }`.
- **Nunca escreve**: não envia mensagem ao cliente, não toca em `metadata`, não emite evento, não muda modo do atendimento. Read + síntese puros.

## Frontend

- `src/components/atendimentos/BuscarLentesSheet.tsx` (Sheet shadcn lateral, 3 abas com Tabs).
- `src/hooks/useBuscarLentes(atendimentoId)` chamando `supabase.functions.invoke("buscar-lentes-operador", ...)`.
- Integração em `src/pages/Atendimentos.tsx`: botão no header, sempre visível com atendimento selecionado.
- "Inserir no composer" via mesmo estado do campo de mensagem já existente (`useState` da página).
- Funciona em qualquer modo (IA / humano / ponte) — UI não distingue.

## Permissões e segurança

- EF autenticada — qualquer operador logado usa. Sem roles novos.
- Sem novas tabelas, sem migrations, sem novas policies (catálogos já legíveis por autenticado).
- Tom/regras (Kodak, Varilux Premium, "provar armações" não "experimentar lentes", DNZ-first) herdadas direto do `_shared/mensagens-gael.ts`.

## Memória

Criar `mem://ia/copiloto-cotacao-operador.md`: painel humano paralelo, motor compartilhado em `_shared/lentes-engine.ts`, mesma linguagem da IA, nunca escreve no chat.

## Fora de escopo

- Alterar comportamento da IA automática.
- Persistir receita editada no sheet (continua em `ReceitaValidacaoPopover`).
- Marcas fora do catálogo (Kodak: só sinaliza badge "escalar humano").
- Histórico/favoritos de busca do operador.
- Auto-envio da mensagem (sempre passa pelo composer).
