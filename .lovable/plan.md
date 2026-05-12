## Objetivo
Corrigir o caso em que a IA fica em “analisando...” sem continuar o fluxo e reduzir o tempo de resposta percebido nas conversas, principalmente quando há foto de receita.

## O que vou implementar
1. **Criar um caminho rápido para receita/imagem no `ai-triage`**
   - Tratar OCR pendente, receita digitada por texto e confirmação de receita **antes** de montar o prompt completo.
   - Quando o caso já estiver claro, seguir por rota determinística ou por uma chamada de tool mais enxuta, sem carregar todo o contexto comercial.
   - Manter a regra: se não conseguir ler a foto, pedir texto; se o cliente disser que não consegue digitar, escalar para humano.

2. **Reduzir a latência do pipeline principal de IA**
   - Evitar carregar conhecimento, exemplos, feedbacks, lojas e histórico longo em todo turno quando isso não for necessário.
   - Enxugar a janela de contexto para fluxos de receita e orçamento simples.
   - Remover retrabalho de imagem/contexto em reprocessamentos do mesmo atendimento.

3. **Diminuir o custo da chamada ao modelo**
   - Substituir o uso indiscriminado do `openai/gpt-5` por uma estratégia mais leve para roteamento e OCR forçado.
   - Reservar o modelo mais pesado só para casos realmente complexos, sem mexer nas regras de negócio.

4. **Fechar o bug do “analisando...” órfão**
   - Reforçar no `ai-triage` que qualquer saída “recebi sua receita / estou analisando” sem `receita_interpretada` no mesmo ciclo vira pedido de texto imediatamente.
   - Manter o `watchdog-inbound-orfao` como rede de segurança para recuperar atendimentos que escaparem.

5. **Instrumentar tempo por etapa**
   - Adicionar logs de duração para: leitura de dados, montagem de contexto, download de mídia, chamada ao modelo e execução de tool.
   - Isso permite confirmar exatamente onde a demora está acontecendo depois do deploy.

## Achados da investigação
- O backend hospedado está saudável; a lentidão não parece ser indisponibilidade da infraestrutura.
- O `ai-triage` está montando um prompt muito grande em chamadas repetidas: **~49k caracteres**.
- Em fluxos com receita, a função baixa a imagem novamente e faz chamadas pesadas ao modelo em ciclos sucessivos.
- Hoje existem casos com **duas chamadas ao modelo** no mesmo atendimento: a chamada principal e o retry forçado de `interpretar_receita`.
- O fluxo atual carrega muita coisa em paralelo mesmo quando o cliente só mandou receita ou confirmou dados.

## Detalhes técnicos
- **Arquivos alvo:**
  - `supabase/functions/ai-triage/index.ts`
  - `supabase/functions/watchdog-inbound-orfao/index.ts`
- **Sem migração de banco** nesta etapa.
- **Abordagem de performance:**
  - fast-path antes do bloco `LOAD ALL DATA IN PARALLEL`
  - contexto menor para OCR/receita
  - menos chamadas ao gateway de IA
  - logs com tempos por fase

## Como vou validar
- Verificar logs do `ai-triage` comparando antes/depois:
  - tamanho do prompt
  - quantidade de chamadas ao modelo
  - tempo por execução
- Confirmar que o fluxo segue corretamente nos cenários:
  - foto legível → interpretar → confirmar → continuar
  - foto ilegível → pedir texto
  - cliente não consegue digitar → escalar humano
  - “analisando...” sem continuação → watchdog/failsafe recupera
- Validar se o `watchdog-inbound-orfao` passa a registrar claramente os eventos do passo de recuperação de “analisando...” órfão.