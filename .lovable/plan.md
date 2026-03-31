

# Análise do Plano: Auto-Compilação do Prompt com IA

## Veredicto: Bom conceito, mas precisa de ajustes para ser realmente eficiente e seguro

---

## O que está BOM no plano

1. **O prompt original nunca é sobrescrito** — correto, mantém rollback
2. **Compilação manual (não automática)** — evita custo desnecessário
3. **Usar gemini-2.5-flash** — bom balanço custo/qualidade para síntese de texto

---

## Problemas e Melhorias Sugeridas

### 1. Risco de Segurança: IA reescrevendo suas próprias regras de segurança

O compilador usa IA para "integrar naturalmente" as proibições no texto. Isso é perigoso:
- A IA pode **diluir** uma proibição ao reformulá-la ("não fazemos exames" → "orientamos sobre exames")
- Proibições devem ser **literais e mecânicas**, não "naturais"

**Melhoria**: As `ia_regras_proibidas` devem continuar sendo injetadas **literalmente** no bloco `⛔ PROIBIÇÕES ABSOLUTAS`, separadas do prompt compilado. O compilador só deve sintetizar exemplos e feedbacks no corpo do prompt. As proibições ficam intocadas.

### 2. Dados dinâmicos que o compilador não pode tocar

O plano menciona que data/hora, lojas e agendamentos continuam dinâmicos. Mas falta explicitar que o `prompt_compilado` substitui **apenas**:
- `businessRules` (prompt_atendimento)
- `examples` (ia_exemplos)
- `antiExamples` (ia_feedbacks)

E **NÃO** substitui:
- Proibições absolutas (segurança)
- Base de conhecimento (muda em tempo real)
- Lojas/agendamentos (muda em tempo real)
- Tópicos já cobertos (sessão específica)
- Modo híbrido (sessão específica)

**Melhoria**: Criar slots no prompt compilado com marcadores (ex: `{{PROIBICOES}}`, `{{CONHECIMENTO}}`, `{{LOJAS}}`) que o `ai-triage` substitui em runtime.

### 3. Falta validação pós-compilação

A IA pode gerar um prompt que remove acidentalmente instruções críticas. Não há checagem.

**Melhoria**: Após compilar, validar automaticamente que o prompt contém palavras-chave obrigatórias: "NUNCA invente preços", "Consultor especializado", "3 frases", "receita". Se faltar alguma, rejeitar e alertar.

### 4. Versionamento fraco

O plano salva apenas `prompt_compilado_anterior` (uma versão). Se compilar 3 vezes e a v1 era a melhor, perdeu.

**Melhoria**: Usar uma tabela separada `prompt_versoes` com timestamp, fontes usadas e conteúdo. Ou no mínimo um array jsonb com as últimas 5 versões.

### 5. A hierarquia de processamento deve ser preservada

Hoje o `ai-triage` segue: Proibições > Prompt > Exemplos > Feedbacks > Conhecimento. Se o compilador funde prompt+exemplos+feedbacks em um bloco só, a IA perde a distinção hierárquica.

**Melhoria**: O compilador deve gerar o prompt com seções Markdown internas marcadas (# REGRAS, # EXEMPLOS INTEGRADOS, # CORREÇÕES APRENDIDAS), mantendo a hierarquia visual.

---

## Plano Revisado Recomendado

### Arquitetura

```text
┌─────────────────────────────────────────────┐
│            compile-prompt                    │
│  Entrada:                                   │
│  - prompt_atendimento (espinha dorsal)       │
│  - ia_exemplos (few-shot)                   │
│  - ia_feedbacks corrigidos                  │
│                                             │
│  NÃO TOCA:                                 │
│  - ia_regras_proibidas (literal)            │
│  - conhecimento_ia (runtime)                │
│  - lojas/agendamentos (runtime)             │
│                                             │
│  Saída:                                     │
│  - prompt_compilado com slots:              │
│    {{PROIBICOES}} {{CONHECIMENTO}}          │
│    {{LOJAS}} {{AGENDAMENTOS}}               │
│                                             │
│  Validação: checklist de palavras-chave     │
└─────────────────────────────────────────────┘
```

### Mudanças no ai-triage

```text
SE prompt_compilado existe:
  1. Carrega prompt_compilado
  2. Substitui slots ({{PROIBICOES}}, {{CONHECIMENTO}}, etc.)
  3. Injeta proibições LITERAIS (não compiladas)
  4. Pula injeção separada de exemplos/feedbacks (já no compilado)
SENÃO:
  Fluxo atual (retrocompatível)
```

### Arquivos

| Arquivo | Ação |
|---------|------|
| `compile-prompt/index.ts` | Criar — compilador com validação |
| `ai-triage/index.ts` | Atualizar — carregar prompt_compilado + substituir slots |
| `PromptCompilerTab.tsx` | Criar — UI de compilação, preview, histórico |
| `LearningCard.tsx` | Atualizar — adicionar aba "Prompt IA" |
| Migração | Adicionar chaves `prompt_compilado`, `prompt_compilado_at`, `prompt_versoes` na `configuracoes_ia` |

### Checklist de validação pós-compilação

O compilador rejeita o resultado se faltar qualquer um:
- "NUNCA invente" (anti-alucinação)
- "Consultor especializado" (terminologia)
- "3 frases" ou "máximo" (concisão)
- "receita" (fluxo core)
- "pergunta" ou "ação" (proatividade)

---

## Resumo

O conceito é sólido, mas precisa de **3 proteções críticas**:
1. Proibições nunca passam pelo compilador (segurança)
2. Validação automática pós-compilação (qualidade)
3. Slots para dados dinâmicos em vez de substituição total (flexibilidade)

Com essas mudanças, o sistema fica robusto e seguro para produção.

