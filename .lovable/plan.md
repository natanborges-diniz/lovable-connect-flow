

# Integrar ESSILOR nas Recomendações do Assistente

## Problema

A estratégia comercial atual prioriza apenas DNZ → DMAX → HOYA → ZEISS. ESSILOR não aparece na ordem de prioridade, não tem regra de posicionamento, e não existe nenhum exemplo de conversa para quando o cliente pede Varilux ou Essilor.

## O que muda

### 1. Atualizar Estratégia Comercial

Atualizar o registro `Estrategia Comercial de Lentes` em `conhecimento_ia` para incluir ESSILOR:

- **Regra ESSILOR**: "usar como referência premium ao lado de HOYA — destacar Varilux como líder mundial em progressivas e Eyezen para visão simples digital"
- **Ordem de prioridade**: DNZ → DMAX → HOYA / ESSILOR → ZEISS
- **Regra de progressivas**: quando cliente precisa de multifocal, mencionar Varilux como opção premium naturalmente (são as progressivas mais usadas no mundo)
- **Regra de visão simples digital**: posicionar Eyezen como alternativa premium à visão simples convencional

### 2. Adicionar exemplos de conversa (ia_exemplos)

| Categoria | Pergunta | Resposta ideal |
|-----------|----------|----------------|
| `cliente_marca` | "quero Essilor" | "Excelente escolha! A Essilor é referência mundial em lentes 😊 Temos toda a linha Varilux para multifocal e Eyezen para visão simples. Quer que eu mostre as opções compatíveis com sua receita?" |
| `cliente_marca` | "quero Varilux" | "Varilux é a multifocal mais usada no mundo, ótima escolha 😊 Temos desde a Liberty até a XR Pro. Quer que eu compare as opções pro seu grau?" |
| `cliente_marca` | "qual a melhor lente multifocal?" | "As Varilux da Essilor são as progressivas mais utilizadas no mundo. Temos também a linha Hoya que é excelente. Quer que eu monte um comparativo com seu grau?" |
| `orcamento` | "quero a melhor lente possível" | "Para o melhor em tecnologia, temos Varilux XR Pro (Essilor) e Hoyalux iD MySelf (Hoya) — ambas são top de linha mundial. Quer que eu compare as duas pro seu grau?" |

### 3. Recompilar prompt

Após inserir os dados, disparar recompilação para que o `prompt_compilado` absorva as novas regras e exemplos.

## Arquivos/tabelas modificados

| Local | Mudança |
|-------|---------|
| `conhecimento_ia` (update) | Estratégia comercial com ESSILOR |
| `ia_exemplos` (insert) | 4 novos exemplos de conversa |
| Edge function `compile-prompt` | Disparar recompilação (invoke) |

## Resultado

- Gael passa a recomendar ESSILOR/Varilux naturalmente em contexto de progressivas premium
- Cliente que pede "Essilor", "Varilux" ou "melhor lente" recebe resposta adequada
- Posicionamento HOYA e ESSILOR lado a lado como premium, sem favorecer uma sobre a outra

