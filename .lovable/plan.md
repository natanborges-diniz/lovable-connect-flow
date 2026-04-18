
## Objetivo
Responder ao Leandro com explicação técnica resumida (Optifog vs Crizal Sapphire HR vs Crizal Prevencia, intermediária/ocupacional vs multifocal ampla), reforçando que a diferença real se percebe presencialmente. Em seguida, oferecer as lojas e perguntar se ele quer agendar.

Não há mudança estrutural pendente — o caso anterior (Kelly) já cobriu o fluxo pós-receita LC. Aqui é Kodak (óculos multifocal), que por regra de memória **escala manual obrigatória** (Kodak Precise não está em `pricing_table_lentes`). O Consultor já passou os valores às 16:31. Falta só responder às perguntas técnicas e empurrar agendamento.

## Diagnóstico
- IA travou em loop "dois caminhos" / "acionei consultor" sem responder dúvidas técnicas específicas (diferença entre lente R$ 1.554 vs R$ 2.045, o que é Optifog, Crizal Sapphire HR, intermediária/ocupacional).
- Cliente quer comparativo conceitual antes de ir à loja.
- Já foi escalado e respondido pelo Consultor, então o canal está em modo humano/híbrido — resposta deve ser manual via `send-whatsapp` no atendimento ativo, remetente "Consultor Diniz" (continuidade da última fala humana).

## Implementação

### Frente única — Resposta operacional manual
Enviar via `send-whatsapp` no atendimento do Leandro, mensagem única consolidando as respostas técnicas + lojas + CTA de agendamento:

> "Oi Leandro! Boa, vou te explicar rapidinho 👇
>
> *Diferença entre R$ 1.554 e R$ 2.045 (ambas Kodak multifocal + Transitions):*
> • R$ 1.554 → traz o **Optifog** (antiembaçante ativado com paninho próprio — útil pra máscara, cozinha, mudança de temperatura).
> • R$ 2.045 → traz o **Crizal Sapphire HR** (antirreflexo premium da Essilor, mais resistente a risco, repele água/gordura, visão mais nítida à noite e contra faróis). Não tem o Optifog incluso, mas o AR é bem superior.
>
> *Resumo dos termos:*
> • **Optifog** = tratamento antiembaçante (precisa ativar com paninho).
> • **Crizal Sapphire HR** = antirreflexo top de linha, mais durável e transparente.
> • **AR Premium** = camada antirreflexo de alta performance (reduz reflexo de tela, farol, luz artificial).
>
> *Multifocal x Ocupacional (intermediária):*
> A multifocal tem 3 campos (longe + intermediário + perto) — uso o dia todo. A ocupacional é otimizada pra perto e intermediário (computador, leitura) — não é pra dirigir. Pelo seu pedido de "campo amplo", a **multifocal** é o caminho.
>
> Mas olha, sinceramente: essas diferenças de antirreflexo e nitidez você sente de verdade **experimentando na loja** — a gente coloca lentes demo pra você comparar lado a lado. É bem rápido e tira a dúvida na hora 👍
>
> *Nossas lojas em Osasco:*
> 📍 **Antônio Agú** (centro)
> 📍 **União Osasco** (shopping, até 22h)
> 📍 **SuperShopping** (até 22h)
>
> Quer que eu já deixe um horário reservado pra quando você vier? Me diz o dia e a unidade que prefere 😊"

(Valores e nomes batem com o que o Consultor já enviou às 16:31 — sem inventar.)

### Sem mudanças de código
- Nenhuma edição em `ai-triage` ou outras EFs.
- Nenhuma migração.
- Nenhuma alteração de memória — caso Kodak já documentado em `mem://ia/marca-kodak-escalada-manual` (escala manual mantida; aqui o humano já está no controle).

## Resultado esperado
- Leandro recebe resposta técnica clara e curta.
- Reforça experiência presencial sem soar evasivo.
- Próximo passo concreto: escolher loja e dia.
- Sem novo loop da IA (atendimento permanece em modo humano/Consultor).

## Arquivo/ação
- Único: chamada `send-whatsapp` para o atendimento ativo do Leandro Laba, remetente "Consultor Diniz".
