## Diagnóstico do loop (Franciana)

Sequência real:

1. Cliente manda foto → OCR lê `OD ESF -1,00 CIL -5,50 EIXO 40 / OE ESF -0,75 CIL -3,00 EIXO 145` → IA pergunta "confere?".
2. Cliente: "Sim" → gate marca `pending=false` e dispara `runConsultarLentes` (fix anterior).
3. `runConsultarLentes` consulta `pricing_table_lentes` com `cylinder_max ≥ 5,50`. Catálogo NÃO cobre cilindro tão alto → zero resultados → cai em `runConsultarLentesEstimativa`, que devolve as 3 faixas (Econômica/Intermediária/Premium) **e termina perguntando** `"Consegue me confirmar o cilindro e eixo de cada olho (ou enviar foto da receita)?"` (linha 5739).
4. Cliente respondeu o cilindro de novo por texto → parser de correção entendeu como "novo ESF" e gravou `OD ESF -5,50 CIL -5,50` (interpretação errada) → IA pediu confirmação outra vez → loop.

Ou seja: o pedido de "confirmar cilindro/eixo" no fim do `consultar_lentes_estimativa` é o gatilho da segunda volta. A receita já estava confirmada pela cliente; perguntar de novo é redundante e ainda contamina o parser de texto.

A regra que o usuário quer é simples: cilindro alto (>4) = `revisão pendente` + segue fluxo IA mostrando estimativa, **sem** pedir nada de volta ao cliente.

## O que vou alterar

Arquivo único: `supabase/functions/ai-triage/index.ts`.

### 1. Gate pós-confirmação não pode "perguntar de novo"

Logo após `runConsultarLentes` no gate (linha ~2335):

- Se `requerRevisaoHumanaPosOrcamento(lastRx).precisa === true`, marcar no `atendimentos.metadata`:
  - `revisao_humana_pendente = true`
  - `revisao_motivos = [...motivos da função]`
  - `revisao_solicitada_at = now()`
  e inserir evento `tipo="revisao_humana_pos_cotacao"` em `eventos_crm`.
- Continua enviando a resposta da cotação com `MSG_REVISAO_HUMANA_SUFIXO` (já é o que faz hoje), mas agora a flag fica acesa também quando o caminho é via estimativa.

### 2. `runConsultarLentes` — quando cair em estimativa com receita JÁ confirmada, não repergunta

No bloco do fallback estimativa (linha ~5444), depois de obter `est.resposta`:

- Se a receita selecionada (`rxMeta`) tem `confirmed_by_client_at`, sanitizar a resposta da estimativa removendo a frase final "Consegue me confirmar o cilindro e eixo..." / "Consegue me enviar foto da receita ou os números de ADD e CIL/AX..." e substituir por CTA de fechamento: `"Quer que eu já te indique a loja mais próxima pra fechar nessa condição? Me passa sua região/bairro 😊"`.
- Anexar `MSG_REVISAO_HUMANA_SUFIXO` se `requerRevisaoHumanaPosOrcamento(rxMeta).precisa`.
- Logar evento `tipo="cotacao_estimativa_pos_confirmacao"` para auditoria.

Implementação prática: depois de `est?.resposta`, aplicar `est.resposta = est.resposta.replace(/Consegue me (confirmar o cilindro[^\n]*|enviar foto da receita ou os números de ADD[^\n]*)\?/gi, "")` e concatenar o CTA + sufixo.

### 3. `runConsultarLentesEstimativa` — fonte da pergunta

Em vez de mexer só no chamador, adicionar um parâmetro opcional `rx_ja_confirmada: boolean`. Quando `true`, pular as duas últimas linhas que perguntam ADD/CIL/EIXO (linhas 5737–5739) e devolver só as faixas + frase neutra `"Posso seguir com uma dessas opções e já te conectar com a loja mais próxima?"`. Chamada em `runConsultarLentes` passa `rx_ja_confirmada: !!rxMeta.confirmed_by_client_at`.

(Itens 2 e 3 são redundantes de propósito — defesa em profundidade. Se algum outro caminho chamar `runConsultarLentesEstimativa` direto, o parâmetro já blinda.)

### 4. Parser de correção por texto — proteção mínima

Caso colateral: a cliente escreveu `"OD: -5,50 CIL/ Eixo 40"` e o parser virou `ESF -5,50 CIL -5,50`. Não vou refatorar o parser nesta tarefa (fora do escopo declarado), mas vou adicionar **uma guarda**: se a receita-alvo já está com `confirmed_by_client_at` e o texto chega no formato "OD: <num> CIL/Eixo <num>", o parser deve interpretar como **correção apenas de cilindro/eixo** (não esférico), preservando o ESF original. Implementação: regex específica `/^OD[:\s]+-?\d+[,.]?\d*\s*CIL\s*\/\s*Eixo\s+\d+/i` antes da regex genérica que mapeia o primeiro número como ESF.

Se isso ficar grande demais, faço como follow-up; mas é de 5–10 linhas em `aplicarCorrecaoReceitaPorTexto` (já existente em `mem://ia/correcao-receita-por-texto`).

### 5. Memória

Atualizar `mem://ia/pos-confirmacao-forca-cotacao.md` com a regra:

> Após confirmação, NUNCA repergunte cilindro/eixo/ADD. Se o catálogo zerar, apresente estimativa + ligue `revisao_humana_pendente`. Cliente só vê CTA de fechamento, nunca pedido de re-digitação.

E linha curta no `mem://index.md` Core: "Receita confirmada → IA nunca repergunta valores; cyl>4 vira `revisao_humana_pendente`."

## Fora de escopo

- Não vou aumentar `cylinder_max` no `pricing_table_lentes` (decisão de catálogo, não de IA).
- Não vou tocar no watchdog nem no `interpretar_receita`.
- Não vou mexer no front da `RevisaoHumanaBadge` (a flag já existe e o badge já lê).

## Resultado esperado

Cliente confirma receita "complexa" (cilindro alto):

1. IA envia 3 faixas de estimativa **sem** pedir confirmação de novo.
2. Sufixo `💡 Como sua receita tem um detalhe específico, vou pedir uma conferência rápida do nosso consultor...` aparece.
3. Atendimento ganha `revisao_humana_pendente=true` → consultor vê o badge no card e confirma/corrige.
4. Próxima inbound do cliente (região, "qual fica perto", etc.) segue fluxo normal de agendamento. Sem loop.
