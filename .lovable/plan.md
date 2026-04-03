

# Plano Unificado: Assistente Robusto com Aprendizado de Conversas Reais + Processamento de Imagens Blindado

## Contexto

Dois problemas críticos convergem: (1) o assistente falha em 83% das vezes quando recebe imagens/receitas, caindo em respostas genéricas; (2) temos 80+ conversas ricas de atendentes humanos que demonstram o comportamento ideal mas não estão sendo aproveitadas para calibrar o Gael.

Este plano unifica ambas as frentes em uma entrega coesa.

---

## PARTE A — Blindagem do Processamento de Imagens

### Problema atual
- `latestInboundImageIndex` compara com o índice da janela de contexto (últimas 20 msgs), mas `media.inline_base64` só existe para a mensagem ATUAL
- Quando a imagem não chega como base64, o modelo recebe apenas `[Cliente enviou uma imagem/receita]` em texto — e responde genericamente
- O validador (`validateResponse`) não sabe que o contexto é de imagem e permite fallbacks genéricos como "Opa, me conta o que precisa"

### Correções no `ai-triage/index.ts`

**A1. Corrigir entrega de imagem ao modelo (linhas 975-1028)**
- Calcular `latestInboundImageIndex` RELATIVO à janela de contexto (não ao array completo)
- Para a mensagem atual: usar `media.inline_base64` com fallback para download via `media_url`
- Para imagens anteriores no histórico: tentar download da `media_url` com timeout 5s
- Se tudo falhar: injetar mensagem de sistema explícita `"[SISTEMA: O cliente enviou uma imagem mas não foi possível processá-la. Reconheça o recebimento e pergunte se é receita.]"`

**A2. Flag `isImageContext` no validador (linhas 1340-1435)**
- Detectar se a mensagem atual é tipo imagem OU contém `[image]`/`[document]`
- Quando `isImageContext = true`: BLOQUEAR todo fallback genérico do `VALIDATOR_FAILED_POOL`
- Forçar fallback contextual de imagem em vez de "me conta mais"

**A3. Novo `imageContextFallback()` dedicado**
- Pool de respostas específicas para quando a imagem não pôde ser processada:
  - "Recebi sua imagem! É uma receita oftalmológica? Se sim, me confirma que eu analiso pra você 😊"
  - "Vi que me enviou uma imagem. Se for receita, me manda uma foto com boa iluminação que eu leio pra você!"
- Substituir o `pickFallback` genérico quando `isImageContext = true`

**A4. Proteção no `deterministicIntentFallback` (linhas 83-98)**
- Já existe detecção de `\[image\]` mas com resposta fixa — diversificar com pool rotativo
- Adicionar detecção de `tipo_conteudo === "image"` no metadata da mensagem atual (não apenas regex no texto)

---

## PARTE B — Extração de Aprendizado das Conversas Humanas

### O que temos
- 80+ diálogos ricos (10+ mensagens) de atendentes humanos via Evolution API
- 10 exemplos modelo ativos em `ia_exemplos`
- 1 regra proibida ativa
- Prompt base com ~500 chars de identidade + estilo

### Processo (execução única via script)

**B1. Exportar conversas ricas**
- Query: atendimentos com `canal_provedor = 'evolution_api'`, 10+ mensagens, distinguir atendente por `remetente_nome`
- Formatar como diálogos estruturados (Cliente: / Atendente:)

**B2. Análise com IA (gemini-2.5-pro)**
Script único que processa as conversas e extrai:
1. **Script de atendimento ideal**: fluxo passo-a-passo observado nos melhores atendimentos
2. **Padrões de objeção**: barreiras comuns do cliente + respostas eficazes do humano
3. **Tom e linguagem**: frases naturais, gírias, emojis, ritmo de resposta
4. **Exemplos modelo**: 15-20 pares pergunta/resposta prontos para `ia_exemplos`
5. **Regras implícitas**: comportamentos que o humano SEMPRE faz ou NUNCA faz

**B3. Relatório de perfil comportamental**
- Gerar PDF com findings + recomendações
- Incluir comparativo: "O humano faz X, o Gael faz Y, recomendação: Z"
- Apresentar para revisão antes de aplicar

**B4. Aplicação dos achados**
Após aprovação:
- Inserir 15-20 novos exemplos em `ia_exemplos` (categorias: orcamento, receita, agendamento, objecao, saudacao)
- Adicionar regras proibidas identificadas em `ia_regras_proibidas`
- Atualizar `prompt_atendimento` com seção `# REGRAS PARA IMAGENS` e ajustes de tom baseados nos achados
- Recompilar prompt via `compile-prompt`

---

## PARTE C — Reforço no Prompt para Imagens

### Adicionar ao `prompt_atendimento`

Nova seção `# REGRAS PARA IMAGENS E RECEITAS`:
- "Quando receber QUALQUER imagem, trate como possível receita oftalmológica"
- "SEMPRE use a tool `interpretar_receita` quando visualizar uma imagem"
- "Se não conseguir ler a imagem: reconheça o recebimento e peça foto mais nítida"
- "NUNCA ignore uma imagem enviada pelo cliente"
- "NUNCA responda com saudação genérica quando o cliente enviou uma imagem"

Essa seção será incluída tanto no prompt base quanto injetada diretamente no `buildSystemPromptFromCompiled`.

---

## Ordem de Execução

| # | Etapa | Tipo |
|---|-------|------|
| 1 | Exportar e analisar conversas humanas (B1-B3) | Script + relatório PDF |
| 2 | Revisar relatório com você | Pausa para aprovação |
| 3 | Corrigir processamento de imagens (A1-A4) | Edge function |
| 4 | Adicionar seção de imagens ao prompt (C) | Banco + edge function |
| 5 | Aplicar exemplos e regras dos achados (B4) | Banco + recompilação |

## Arquivos a Modificar

| Arquivo | Ação |
|---------|------|
| Script temporário (`/tmp/analyze_conversations.py`) | Exportar + analisar conversas com IA |
| `/mnt/documents/perfil_comportamental_gael.pdf` | Relatório de achados |
| `supabase/functions/ai-triage/index.ts` | A1-A4: blindagem de imagens |
| `configuracoes_ia` (prompt_atendimento) | C: seção de regras para imagens + ajustes de tom |
| `ia_exemplos` (insert) | B4: 15-20 novos exemplos extraídos |
| `ia_regras_proibidas` (insert) | B4: regras identificadas nos padrões humanos |

## Resultado Esperado

- Taxa de reconhecimento de receita: de **16.7%** para **>80%**
- Eliminação total de respostas genéricas após envio de imagem
- Gael com tom e comportamento calibrado a partir de atendimentos reais de sucesso
- Base de exemplos expandida de 10 para 25-30
- Prompt enriquecido com script de atendimento real

