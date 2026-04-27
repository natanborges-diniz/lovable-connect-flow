## Diagnóstico encontrado

O problema não foi uma única falha; foram 3 falhas em sequência no fluxo da IA.

1. A primeira leitura da imagem aconteceu, mas voltou vazia
   - No histórico do backend, a receita foi salva às 23:35 como:
     - `rx_type: unknown`
     - `confidence: 0.75`
     - `eyes.od = {}`
     - `eyes.oe = {}`
     - `needs_human_review: true`
   - Ou seja: a IA até tentou interpretar a foto, mas não extraiu nenhum grau útil.

2. Mesmo com a leitura vazia, o sistema passou a tratar isso como “já existe receita”
   - A partir daí, o roteamento deixou de priorizar nova leitura da imagem.
   - Em vez de insistir no `interpretar_receita`, o fluxo passou a agir como se já houvesse receita salva e começou a cair no orçamento / fallback.
   - Isso explica respostas como:
     - “Já estou analisando...”
     - “Sobre o que a gente estava falando...”
     - “Não consegui identificar o grau completo...”

3. A correção digitada pelo cliente também foi parseada de forma errada
   - O cliente mandou: `Od -400 / Oe - 425`
   - O sistema salvou apenas:
     - `OD = -400`
     - `OE = null`
   - Então houve dois problemas adicionais:
     - `-400` foi entendido literalmente, e não como `-4,00`
     - `Oe - 425` não foi lido corretamente por causa do espaço após o sinal
   - Resultado: o motor de orçamento tentou buscar lentes para um grau impossível (`-400`) e sem o OE completo, então não encontrou combinações automáticas.

## Causa raiz no código

### 1) Receita “inválida” conta como receita válida
Arquivo: `supabase/functions/ai-triage/index.ts`
- O roteador usa `hasReceitas` como critério simples.
- Hoje, basta existir algo em `metadata.receitas` para o sistema parar de forçar `interpretar_receita`.
- Isso é incorreto quando a receita salva está com:
  - `rx_type = unknown`
  - ambos os olhos vazios
  - confiança baixa / revisão humana

### 2) O parser de correção textual é frágil
Arquivo: `supabase/functions/ai-triage/index.ts`
- O regex atual não lida bem com formatos como:
  - `- 425`
  - `+ 200`
- E não normaliza shorthand comum de óptica:
  - `-400` deveria virar `-4.00`
  - `-425` deveria virar `-4.25`

### 3) O motor de orçamento não diferencia “receita parcialmente inválida” de “grau raro sem preço” 
Arquivo: `supabase/functions/ai-triage/index.ts`
- Quando recebe um grau mal interpretado, ele simplesmente tenta consultar a tabela de preços.
- Como não acha resultado, responde como se o problema fosse indisponibilidade, quando na verdade o problema era parsing inválido.

## Plano de correção

1. Blindar o conceito de “receita válida” no `ai-triage`
   - Criar uma checagem de validade da receita salva.
   - Só considerar “tem receita” quando houver pelo menos um olho com esfera/cilindro útil e `rx_type` coerente.
   - Se a receita salva estiver vazia ou `unknown`, continuar priorizando nova interpretação da imagem.

2. Reabrir OCR quando a receita salva for fraca
   - Se houver imagem recente e a receita salva estiver inválida ou com baixa qualidade, forçar `interpretar_receita` de novo em vez de seguir para orçamento.
   - Isso evita o falso estado de “já li sua receita”.

3. Melhorar o parser de receita digitada
   - Aceitar espaços entre sinal e número (`- 425`).
   - Normalizar shorthand óptico:
     - `400` → `4.00`
     - `425` → `4.25`
     - preservar formatos já corretos como `-4,25`.
   - Garantir captura separada de OD e OE.

4. Endurecer o fallback do orçamento
   - Se a receita estiver parcial/inconsistente, pedir os dados em formato objetivo:
     - `OD esf/cil/eixo`
     - `OE esf/cil/eixo`
   - Não responder “não localizei combinações” quando o erro real for leitura inválida.

5. Registrar essa regra na memória operacional da IA
   - Documentar o caso do Jardel para evitar regressão futura em leituras vazias + correção textual shorthand.

## Resultado esperado após a correção

No caso do Jardel, o comportamento correto passaria a ser:
- a primeira leitura falha não “consome” a receita;
- após o “Sim”, a IA tenta ler a imagem novamente;
- se o cliente digitar `OD -400 / OE -425`, o sistema normaliza para `OD -4,00 / OE -4,25`;
- com a receita válida, o orçamento segue normalmente ou pede apenas o dado faltante de forma objetiva.

## Detalhes técnicos

Trechos relevantes já identificados:
- `detectForcedToolIntent(...)` bloqueia nova interpretação quando `hasReceitas = true`
- `consultar_lentes` cai em fallback quando `rx_type === "unknown"` ou quando a busca não encontra combinações
- `detectPrescriptionCorrection(...)` precisa aceitar shorthand e espaços no sinal
- o caso do Jardel mostrou na base:
  - leitura OCR inicial vazia
  - correção textual parcial (`OD=-400`, `OE=null`)
  - posterior escalada humana por ausência de combinações

Se você aprovar, eu implemento essas correções no `ai-triage` e deixo esse cenário protegido para próximos atendimentos.