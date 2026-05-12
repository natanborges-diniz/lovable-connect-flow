## Problema

Duas dores reais aparecendo nas conversas dos clientes:

1. **Vazamento de instruções internas** colando no texto enviado (ex.: "Confirmar o nome do cliente para dar sequência no atendimento", "Aguardar resposta", "Para prosseguir…"). Já corrigi a saudação inicial com fast-path determinístico, mas o vazamento pode acontecer em **qualquer turno** — não só no 1º.
2. **Tom robotizado** em vários momentos (frases longas, formais, cheias de "prezado", "informo que", "favor aguardar"), denunciando que é IA.

Hoje só temos o `sanitizeLeakedInstructions` cobrindo ~12 padrões e o filtro `proximo_passo` só pergunta. Falta:
- **Guardrail estrutural** (não só regex) que rejeite QUALQUER texto que pareça meta-instrução, em qualquer turno.
- **Camada de "humanização"** que padronize o tom Gael (curto, natural, sem jargão corporativo) antes do envio.
- **Auditoria visível** — hoje vazamento vira log, mas a operadora não vê. Precisa aparecer no painel de auditoria pra corrigir o prompt na origem.

## O que vou implementar

### 1. Guardrail anti-vazamento universal (todos os turnos)

Em `sanitizeLeakedInstructions` (`ai-triage/index.ts` ~linha 6560), expandir para detectar:

- **Verbos de meta-ação no infinitivo no fim da frase**: "Confirmar X", "Aguardar Y", "Verificar Z", "Validar…", "Identificar…", "Solicitar…", "Encaminhar…", "Registrar…", "Prosseguir…", "Seguir com…", "Dar sequência…" — quando aparecem como frase isolada (não dentro de uma fala natural).
- **Marcadores de bloco de prompt vazados**: linhas começando com `[`, `##`, `**REGRA**`, `**INSTRUÇÃO**`, `IMPORTANTE:`, `OBS:` no meio do texto enviado.
- **Nomes de tools/campos internos**: `agendar_visita`, `interpretar_receita`, `consultar_lentes`, `proximo_passo`, `intencao`, `coluna_pipeline`, `setor_destino`.
- **Frases "de robô"**: "como assistente virtual", "sou uma IA", "modelo de linguagem", "fui treinado", "minha base de dados".

Quando detectar vazamento crítico (tool name, campo interno, marcador de bloco), **bloqueia o envio** e dispara fallback humanizado contextual em vez de só remover trecho — hoje remove e pode mandar mensagem mutilada.

### 2. Validador estrutural pré-envio (defesa em profundidade)

Antes de `sendWhatsApp`, novo passo `validarTomHumano(texto)`:
- Rejeita se `texto.split(' ').length < 3` (muito curto pós-sanitização).
- Rejeita se >40% das palavras forem caixa-alta ou houver `**`/`__`/`###` (markdown vazado).
- Rejeita se terminar com infinitivo solto ("…confirmar.", "…verificar.", "…aguardar.").
- Em caso de rejeição: loga `[GUARDRAIL-TOM]`, registra em `eventos_crm` (`tipo='resposta_bloqueada_tom'` com payload do texto original) e envia fallback genérico humano ("Só um instante, já te respondo 😊" + agenda re-disparo via watchdog).

### 3. Reforço de tom Gael no prompt

Em `buildSystemPrompt`/`configuracoes_ia.regras_globais` (carregado no `ai-triage`), adicionar bloco fixo no topo:

```
TOM OBRIGATÓRIO (não-negociável):
- Fale como humano: curto, direto, caloroso. Máx 2 frases por mensagem (salvo cotação).
- PROIBIDO: "prezado", "informo que", "favor", "aguardar", "verificar", "prosseguir", "dar sequência", "conforme solicitado", "estou à disposição", "atenciosamente".
- PROIBIDO descrever o que VOCÊ vai fazer ("Vou verificar…", "Estou analisando…"). Faça e responda o resultado.
- PROIBIDO mencionar "IA", "assistente virtual", "sistema", "base de dados".
- proximo_passo é METADADO INTERNO. NUNCA escreva nele texto que possa ser lido pelo cliente como instrução.
```

### 4. Auditoria visível

Quando guardrail dispara (vazamento ou tom), além de log:
- Insere registro em `ia_feedbacks` com `tipo='vazamento_guardrail'`, `resposta_original`, `resposta_corrigida`, `motivo`.
- Aparece no `AuditoriaIaCard` em Configurações para a operadora revisar e ajustar prompt/exemplo na origem.

### 5. Memória

Atualizar `mem://ia/saudacao-confirma-nome` e criar `mem://ia/guardrail-tom-humano` documentando os 4 níveis de defesa: prompt → fast-path → sanitizer → validador estrutural → auditoria.

## Arquivos afetados

- `supabase/functions/ai-triage/index.ts` — expandir `sanitizeLeakedInstructions`, novo `validarTomHumano`, hooks de auditoria.
- `configuracoes_ia.regras_globais` (linha de DB, via migration) — bloco TOM OBRIGATÓRIO no topo.
- `src/components/configuracoes/AuditoriaIaCard.tsx` — novo filtro/badge para `vazamento_guardrail`.
- Memórias novas/atualizadas.

Sem mudança de UI no CRM. Sem mudança de schema relevante (só seed em `configuracoes_ia` e novo `tipo` em `ia_feedbacks`, que já é texto livre).

## Validação

- Reproduzir o caso Mary/Gi → mensagem sai limpa.
- Forçar modelo a retornar `proximo_passo="Aguardar resposta"` num turno qualquer (não só 1º) → bloqueado e auditado.
- Forçar resposta com "Prezado cliente, informo que estarei verificando" → bloqueado por tom.
- Conferir `AuditoriaIaCard` mostrando os bloqueios para a operadora corrigir.
