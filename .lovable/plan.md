## Diagnóstico

A mensagem chegou assim ao cliente:

> "Olá! Falo com Gi? 😊 Aqui é o Gael das Óticas Diniz Osasco **Confirmar o nome do cliente para dar sequência no atendimento.**"

Duas coisas distintas aconteceram:

### 1. Vazamento do campo `proximo_passo` no texto enviado
- O bloco `# PRIMEIRA INTERAÇÃO — CONFIRMAR NOME` (em `ai-triage/index.ts` linha 1503) já entrega ao modelo a **mensagem literal** a enviar: `"Olá! Falo com Gi? 😊 Aqui é o Gael das Óticas Diniz Osasco."`
- O modelo copiou essa frase como `resposta`, mas preencheu `proximo_passo` com a descrição interna **"Confirmar o nome do cliente para dar sequência no atendimento."**
- Em `index.ts` linha 4189-4202, o código **concatena `proximo_passo` na resposta** sempre que ele não for pergunta repetida. Como a frase não terminava em "?", o filtro `_ppEhPergunta` não bloqueou e ela foi colada no texto final.
- O `sanitizeLeakedInstructions` (linha 6517) cobre vários padrões mas **não cobre essa frase específica**.

### 2. Nome "Gi" em vez de "Mary"
- O webhook capturou o `senderName` do WhatsApp como "Gi" (apelido configurado no perfil dela). É o dado real que o Meta entregou — não é bug do nosso lado, é como ela aparece no WhatsApp. A confirmação de nome existe exatamente pra esse caso: ela responde "Mary" e a tool `registrar_nome_cliente` corrige.

## O que vou corrigir

### A. Tornar a 1ª saudação 100% determinística (elimina o vazamento na raiz)
Quando `buildFirstContactBlock` produz uma mensagem literal entre aspas (1ª interação ou `precisa_confirmar_nome`), **pular o LLM** e enviar `msg` direto via `sendWhatsApp`. Isso:
- Elimina qualquer chance de vazamento de `proximo_passo` ou de instruções internas na saudação.
- Reduz latência da 1ª resposta (sem chamada ao gateway).
- Mantém a tool `registrar_nome_cliente` ativa no próximo turno, quando o cliente responder.

A saudação fica exatamente:
- Com nome candidato → `"Olá! Falo com [PrimeiroNome]? 😊 Aqui é o Gael das Óticas Diniz Osasco."`
- Sem nome → `"Oi! Tudo bem? Aqui é o Gael das Óticas Diniz Osasco 😊 Posso saber seu nome, por favor?"`

### B. Endurecer o merge de `proximo_passo` (defesa em profundidade)
Em `index.ts` ~linha 4197: só concatenar `proximo_passo` na `resposta` se ele **for uma pergunta** (terminar em `?`). Se for descritivo/imperativo ("Confirmar…", "Aguardar…", "Verificar…", "Prosseguir com…"), **descartar** — esse campo é metadado interno, não texto pro cliente. Aplicar a mesma regra no retry da linha 5155.

### C. Ampliar `sanitizeLeakedInstructions`
Adicionar padrões que cobrem descrições de ação tipicamente vazadas como `proximo_passo`:
- `confirmar o nome do cliente[^\n]*`
- `dar sequ[êe]ncia (no|ao) atendimento[^\n]*`
- `para (prosseguir|continuar|seguir)[^\n]*`
- `aguardar (resposta|retorno) do cliente[^\n]*`

### D. Memória
Atualizar `mem://ia/saudacao-confirma-nome` documentando que a 1ª saudação é determinística (não passa pelo LLM) e que `proximo_passo` só é anexado se for pergunta.

## Arquivos afetados
- `supabase/functions/ai-triage/index.ts` — short-circuit da 1ª saudação, hardening do merge `proximo_passo`, ampliação do sanitizer.
- `.lovable/memory/ia/saudacao-confirma-nome.md` — registrar a regra.

Sem migração de banco. Sem mudança de UI.

## Validação
- Reproduzir o caso Mary/Gi: novo contato com `senderName="Gi"` → mensagem enviada deve ser exatamente `"Olá! Falo com Gi? 😊 Aqui é o Gael das Óticas Diniz Osasco."` sem sufixo.
- Conferir log: deve aparecer `[FAST-PATH] greeting_deterministic_sent` e **nenhuma** chamada ao `ai-gateway` nesse turno.
- Forçar caso onde modelo retorna `proximo_passo="Aguardar resposta do cliente."` em outro turno → confirmar que o texto enviado **não contém** essa frase.