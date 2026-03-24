
Objetivo: refazer o fluxo de atendimento para ficar confiável, previsível e sem repetição, validando o caso real do número de homologação.

## Diagnóstico profundo (com base nas 2 últimas mensagens)

1) Conversa real (últimas 2 entradas):
- Cliente: “outra chance pra você me atender bem”
- IA: “Se precisar de mais informações ou quiser agendar uma visita, estou por aqui!”
- Cliente: “quero falar de outra coisa”
- IA: “Entendi! Se precisar de mais informações ou quiser agendar uma visita, estou por aqui.”

2) Causa raiz crítica (bug estrutural, não prompt):
- O `ai-triage` busca histórico com `order(created_at asc).limit(30)`.
- Esse atendimento tem **137 mensagens**.
- Resultado: a IA está lendo as **30 mais antigas**, não as recentes.
- Prova: janela usada termina em 23/03 21:28, enquanto as últimas mensagens são 24/03 18:08.
- Impacto: a IA praticamente não “vê” o diálogo atual e entra em resposta genérica repetitiva.

3) Causas adicionais:
- Base de conhecimento, exemplos e anti-exemplos estão vazios (`KB:0 | Exemplos:0 | Anti:0`), reduzindo precisão.
- Não existe validação pós-modelo para bloquear resposta genérica/repetida antes de enviar.
- Em modo híbrido, falta política de retomada clara para “mudei de assunto”.

## Plano de refatoração robusta (sem remendo)

### Fase 1 — Corrigir motor de contexto (bloqueador principal)
1. Ajustar carregamento de histórico no `ai-triage`:
- Buscar `order desc limit N` (ex: 60), depois inverter para ordem cronológica.
- Garantir que a mensagem inbound atual esteja sempre no contexto final.
2. Adicionar janela híbrida:
- Últimas 20 mensagens verbatim + resumo curto das anteriores (quando conversa longa).
3. Revisar `extractSentTopics`:
- Extrair só de janela recente (não de conversa inteira), para evitar “proibição global” de temas.

### Fase 2 — Orquestração determinística antes do modelo
4. Criar roteador de intenção pré-LLM (regras explícitas):
- Escalonamento humano (já existe bypass): manter e ampliar.
- “Troca de assunto” (`outro assunto`, `falar de outra coisa`) => resposta obrigatória de clarificação (“Perfeito, sobre qual tema: orçamento, pedido, produtos, financeiro?”), sem texto genérico.
5. Definir política de modo híbrido:
- Se já escalado e cliente manda mensagem ambígua, IA deve captar intenção com pergunta objetiva (não CTA de visita).

### Fase 3 — Geração com contrato rígido + guardrails
6. Trocar para arquitetura de “dupla validação”:
- Modelo gera via tool estruturada.
- Validador local rejeita resposta se:
  - bater em blacklist (“se precisar...”, “estou por aqui...” etc),
  - for muito similar às 3 últimas saídas,
  - não avançar a conversa (sem pergunta útil/ação).
- Se rejeitar: 1 tentativa de regeneração com correção; se falhar, fallback determinístico curto.
7. Fortalecer schema da tool `responder`:
- Campos obrigatórios: `resposta`, `intencao`, `coluna_pipeline`, `proximo_passo` (pergunta objetiva ou ação).
- Sem `proximo_passo`, não envia.

### Fase 4 — Modelo e stack (mais forte e estável)
8. Migrar o `ai-triage` para o gateway de IA da plataforma (não depender de chamada direta externa):
- Modelo recomendado para qualidade máxima: `openai/gpt-5`.
- Fallback operacional: `openai/gpt-5-mini`.
- `temperature` baixa (0–0.2), foco em consistência.
9. Manter tools + classificação por coluna, mas com validação de output antes do envio ao WhatsApp.

### Fase 5 — Dados mínimos para precisão real
10. Criar seed mínimo obrigatório de conhecimento:
- produtos/lentes/fluxos financeiros/status.
- Sem esse seed, ativar “modo restrito” (pergunta de clarificação + escalonamento quando necessário), sem inventar resposta.

### Fase 6 — Observabilidade + rollout seguro
11. Log de decisão estruturado em `eventos_crm.metadata`:
- `history_window_range`, `validator_flags`, `fallback_reason`, `intent_router_hit`.
12. Rollout em 2 etapas:
- etapa A: só número homologado;
- etapa B: produção após checklist de aceite.

## Critérios de aceite (incluindo “as duas últimas”)
- Caso 1: “outra chance pra você me atender bem” → IA responde com pergunta objetiva de tema (não “se precisar...”).
- Caso 2: “quero falar de outra coisa” → IA muda contexto e oferece opções de assunto, sem repetir visita/endereço.
- Conversa com >100 mensagens continua coerente com mensagens recentes.
- Se cliente pedir humano, escalonamento imediato continua 100% funcional.
- Nenhuma resposta enviada sem passar no validador anti-repetição/anti-genérico.

## Detalhes técnicos (arquivos e mudanças)
- `supabase/functions/ai-triage/index.ts`
  - refatorar loader de histórico (desc + reverse + janela),
  - adicionar roteador pré-LLM,
  - adicionar validador pós-LLM,
  - reforçar contrato de tool e fallback determinístico.
- Migração SQL (se necessário):
  - índice em `mensagens(atendimento_id, created_at desc)` para histórico longo.
- Sem mexer em autenticação nem em arquivos auto-gerados.

Resultado esperado: atendimento deixa de “ficar burro” em conversas longas, passa a responder com contexto atual e comportamento previsível, robusto e auditável.
