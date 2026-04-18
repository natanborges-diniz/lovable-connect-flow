
Cliente reclama de fricção real e visível na conversa:

1. **Receita já foi enviada** (12:57) — a IA recebeu, mas em vez de **executar a leitura** (`interpretar_receita`) e **gerar o orçamento**, ficou perguntando "quer que eu analise?" repetidamente.
2. **A cliente já respondeu "Orçamento inicial"** às 12:06 — e a IA respondeu DUAS vezes a mesma frase genérica ("Recebi sua receita aqui... Quer que eu analise pra você?"), uma às 12:06 e outra às 12:42 (36 min depois!).
3. **Loop confirmado**: mesma resposta literal repetida = falha do anti-repetição + falha do executor de tools.

## Diagnóstico técnico (sem mudar nada ainda)

Pelo que já mapeei na base:
- Existe `mem://ia/auto-receita-e-anti-loop` — auto-OCR deveria disparar `interpretar_receita` automaticamente quando há **imagem + intent de orçamento**.
- Existe `mem://ia/diretriz-consolidacao-perguntas` — proíbe perguntas redundantes.
- Existe guardrail anti-similaridade >70% que deveria ter bloqueado a resposta repetida das 12:42.

**Algo falhou nas 3 camadas simultaneamente.** Antes de propor mudanças, preciso confirmar o que aconteceu nesse atendimento específico — senão a correção vai ser no escuro como das outras vezes.

## Plano de investigação (read-only, depois proposta)

### Passo 1 — Inspecionar o atendimento da Fábia
- Buscar o `atendimento_id` pelo telefone/nome.
- Listar mensagens com `metadata` (ver se receita foi salva em `contatos.metadata.receitas[]`).
- Listar `eventos_crm` desse contato nas últimas 2h: ver disparos de `interpretar_receita`, `consultar_lentes`, escalonamentos, watchdog.

### Passo 2 — Logs do `ai-triage` para esse contato
- Ver se a tool `interpretar_receita` foi chamada e o que retornou.
- Ver se `consultar_lentes` foi chamada após cliente dizer "Orçamento inicial".
- Ver se houve `finish_reason=length`, `triage_status:402`, ou guardrail bloqueando.

### Passo 3 — Verificar por que o anti-loop não barrou as 12:42
- Repetição literal de resposta → guardrail deveria ter forçado tool ou escalado.
- Ver `metadata.last_outbound_text` e similaridade.

### Passo 4 — Diagnóstico final + proposta corretiva

Com base nos achados, vou propor UMA das três correções (ou combinação):

**A) Promoção de intent**: quando cliente envia imagem + já está em fluxo de orçamento, **pular** a pergunta "quer que eu analise?" — disparar `interpretar_receita` direto e em seguida `consultar_lentes`. Cliente que mandou receita quer orçamento. Ponto.

**B) Endurecer anti-loop**: se a IA repete frase com >85% similaridade, **forçar** tool call (`interpretar_receita` ou `consultar_lentes`) ou escalar — nunca repetir a mesma pergunta.

**C) Fast-path "tenho receita + quero orçamento"**: novo exemplo few-shot + regra dura: imagem reconhecida como receita → confirmar UMA vez ("Recebi! Vou analisar agora") → executar tools em sequência → entregar valores.

### Resultado esperado
Após investigação eu volto com:
- O **motivo exato** do loop (tool não disparou? guardrail off? estado perdido?)
- A **correção mínima** que resolve a causa raiz (não paliativo)
- Eventualmente novos exemplos/regras na base de aprendizado do Gael

Quer que eu execute a investigação agora?
