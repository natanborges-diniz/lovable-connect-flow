## Problema observado (caso Loren)

Após receber orçamento (DNZ/HOYA), a cliente perguntou **"Tem Varilux?"** — que é um filtro/refinamento de marca dentro do mesmo intent (orçamento de multifocal). A IA, em vez de re-chamar `consultar_lentes` filtrando por Essilor/Varilux (que existe no catálogo: Comfort, XR Design, XR Lite, Physio Extensee, etc.), caiu no **loop-detector** (`ai-triage/index.ts` linha ~2546) que escalou para humano com a frase fixa:

> "Vou chamar alguém da equipe pra te ajudar melhor com isso, tá? 😊"

Dois defeitos somados:

1. **Refinamento de marca não é loop**: o detector não reconheceu que a pergunta era um intent claro de re-orçamento filtrado, e tratou como ambiguidade → escalada.
2. **Texto fixo ignora horário comercial**: 19:02 SP é fora do expediente humano (Seg-Sex 09-18, Sáb 08-12). A mensagem deveria avisar a cliente que o time só responde no próximo expediente, igual ao que o `watchdog-loop-ia` já faz com `isHorarioHumano()` + `proximaAberturaHumana()`.

## Mudanças propostas

### 1. Detectar refinamento por marca antes do loop-escalation (`ai-triage/index.ts`)

No bloco do loop-detector (~linha 2530), antes de cair no `else { escalating to human }`, adicionar uma checagem:

- Se o último inbound do cliente bate com regex de marca conhecida (`/varilux|essilor|zeiss|hoya|kodak|dnz|dmax/i`) **E** existe receita salva **E** o histórico recente contém um orçamento de óculos (presença de `🔍 Opções|R$|DNZ|HOYA|ESSILOR|ZEISS` em outbound recente), forçar `consultar_lentes` com `preferencia_marca = <marca detectada>` em vez de escalar.
- Adicionar hint do sistema: "Cliente está pedindo a mesma família de produto filtrada por marca X — re-execute consultar_lentes com preferencia_marca=X. NÃO escale."

Isso aproveita o parâmetro `preferencia_marca` que já existe em `consultar_lentes` (linha 3867).

### 2. Mensagem de escalada sensível ao horário (`ai-triage/index.ts`)

Extrair as helpers `spNow()`, `isHorarioHumano()` e `proximaAberturaHumana()` (já existentes em `watchdog-loop-ia/index.ts`) e replicá-las em `ai-triage/index.ts` (ou mover para um util compartilhado se já houver — caso contrário, duplicar é aceitável dado padrão atual de Edge Functions sem subpastas).

Substituir as mensagens fixas de escalada por uma função `mensagemEscaladaHumano()` que retorna:
- **Dentro do expediente**: "Vou chamar alguém da equipe pra te ajudar melhor com isso, tá? 😊"
- **Fora do expediente**: "Vou acionar nossa equipe humana 🙌 Como já passamos do nosso horário (Seg-Sex 09h-18h, Sáb 08h-12h), assim que abrir o próximo expediente (`{proximaAberturaHumana()}`) eles te respondem por aqui 😉"

Aplicar nos pontos de escalada com texto fixo identificados:
- Linha ~2555 (loop-detector)
- Linha ~2447 (fechamento LC → consultor)
- Linha ~682 (pool exhausted)
- Qualquer outro `sendWhatsApp` que use frases tipo "vou chamar/acionar Consultor".

### 3. Memória

Atualizar `mem://atendimento/horario-comercial-humano` para registrar que **TODA** mensagem de escalada para humano (ai-triage + watchdogs) deve passar pela helper de horário, evitando regressões futuras.

## Arquivos a editar

- `supabase/functions/ai-triage/index.ts` — adicionar helpers de horário, função `mensagemEscaladaHumano()`, branch de refinamento por marca no loop-detector.
- `.lovable/memory/atendimento/horario-comercial-humano.md` — documentar regra unificada.

## Resultado esperado

- "Tem Varilux?" após orçamento → IA re-consulta com filtro Essilor e devolve 2-3 opções Varilux com preços, sem escalar.
- Quando a escalada for genuinamente necessária fora do expediente, a cliente recebe aviso explícito do próximo horário de retorno em vez de ficar sem resposta.