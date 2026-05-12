---
name: Guardrail de tom humano + anti-vazamento (4 camadas)
description: Defesa em profundidade contra vazamento de prompt/proximo_passo e tom robotizado em qualquer turno. Bloqueio crítico envia fallback humanizado e audita em ia_feedbacks.
type: feature
---

## 4 camadas de defesa (em ordem)

1. **Prompt — TOM OBRIGATÓRIO** (`ai-triage/index.ts` ~linha 1775, no `buildSystemPrompt`):
   bloco fixo no topo proibindo "prezado/informo que/favor/aguardar/verificar/prosseguir", auto-referência como "IA/assistente/sistema", marcadores internos `[FLUXO]`/`##`/`**REGRA**`, nomes de tools/campos. Inclui regra explícita: `proximo_passo` é METADADO — se não for pergunta, deixe VAZIO.

2. **Fast-path determinístico de saudação** (~linha 2415): 1ª interação NÃO passa pelo LLM. Ver `mem://ia/saudacao-confirma-nome`.

3. **Sanitizer estrutural `sanitizeLeakedInstructions`** (~linha 6565):
   - Padrões clássicos (instrução interna, bullets de prompt, marcadores `[FLUXO]`/`##`/`**REGRA**`/`IMPORTANTE:`).
   - **Crítico** (dispara fallback): nomes de tool (`agendar_visita`, `interpretar_receita`, `consultar_lentes*`, `registrar_nome_cliente`, `responder`, `escalar`, …), nomes de campo interno (`proximo_passo`, `intencao`, `coluna_pipeline`, `setor_destino`), frases de robô ("sou uma IA", "fui treinado", "minha base de dados", "como assistente virtual").
   - Verbo de meta-ação no infinitivo como linha isolada (`Confirmar X.`, `Aguardar Y.`).
   Retorna `{ texto, alterado, criticalLeak, motivo }`.

4. **Validador de tom `validarTomHumano`** (~linha 6649):
   - Texto vazio/<3 chars/<2 palavras → bloqueia.
   - Começa com `*`/`#`/`-`/`•`/`=` → bloqueia (marcador).
   - Contém `**`/`__`/`###`/triplo crase → bloqueia (markdown vazado).
   - >50% das palavras grandes em CAIXA-ALTA → bloqueia.
   - Termina com infinitivo solto (`…confirmar.`, `…aguardar.`) → bloqueia.

## Bloqueio crítico → fallback + auditoria

Em `sendWhatsApp` (~linha 6712): se `criticalLeak===true` OU validador retorna `ok:false`, substitui o texto pelo fallback humanizado **"Só um instante que já te respondo direitinho 😊"** (o re-disparo natural acontece no próximo turno do cliente ou via watchdog).

Toda alteração (sanitização ou bloqueio) registra em `ia_feedbacks`:
- `avaliacao = 'vazamento_guardrail'`
- `motivo = <padrões detectados>` (ex.: `"tool:agendar_visita|infinitivo_no_fim"`)
- `resposta_corrigida = "[ORIGINAL]…\n[ENVIADO]…"`

`AuditoriaIaCard` em Configurações já lê `ia_feedbacks` e pode ser filtrado por `avaliacao='vazamento_guardrail'` para a operadora corrigir o prompt na origem.

## Caso disparador (12-mai-2026)

Cliente Mary recebeu `"Olá! Falo com Gi? 😊 Aqui é o Gael das Óticas Diniz Osasco Confirmar o nome do cliente para dar sequência no atendimento."` — `proximo_passo` descritivo colado no fim. Diagnóstico inicial cobriu só a 1ª saudação (fast-path). Esta camada cobre **todos os turnos** + adiciona auditoria visível.
