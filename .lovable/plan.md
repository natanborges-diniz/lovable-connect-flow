

# Recuperação Automática de Leads Inativos (Vendas)

## Problema

Leads que param de responder nas fases iniciais (Novo Contato, Lead, Orçamento, Qualificado) ficam parados indefinidamente sem nenhuma ação de follow-up. Não existe coluna terminal "Perdidos" no pipeline de vendas, nem mecanismo de cadência de recuperação.

## Estratégia: 3 tentativas em 7 dias

| Tentativa | Quando | Template | Tom |
|-----------|--------|----------|-----|
| 1a | 48h sem resposta | `retomada_contexto_1` | Retoma o assunto da conversa, pergunta se ainda tem interesse |
| 2a | 72h após a 1a | `retomada_contexto_2` | Oferece ajuda adicional, menciona que está disponível |
| 3a | 72h após a 2a | `retomada_despedida` | Despedida gentil, deixa porta aberta para futuro contato |

Após a 3a tentativa sem resposta: move para **"Perdidos"** automaticamente.

**Total: ~7 dias de cadência** (48h + 72h + 72h).

Se o cliente responder a qualquer momento, o fluxo de recuperação é cancelado e o atendimento retorna ao normal.

## Por que 3 tentativas

- Menos de 3: abandona leads que apenas se distraíram
- Mais de 3: torna-se spam e prejudica a reputação do número oficial
- 3 é o padrão de mercado para cadências de follow-up B2C

## Garantias

- **Canal oficial apenas**: templates enviados via `send-whatsapp-template` (Meta API), nunca pelo canal não-oficial
- **Contextual**: antes de enviar, o cron invoca `summarize-atendimento` para gerar um resumo da conversa e inseri-lo como parâmetro do template
- **Sem repetição**: cada tentativa usa um template diferente
- **Cancela ao responder**: quando o webhook recebe mensagem inbound, zera o contador de recuperação

## Mudanças

### 1. Nova coluna "Perdidos" no pipeline de vendas

Migration para criar a coluna terminal com ordem 12 (após Agendamento).

### 2. Campos de controle no contato

Migration para adicionar ao `contatos.metadata`:
- Não precisa de novas colunas — usar `metadata.recuperacao_vendas` com:
  - `tentativas`: número (0-3)
  - `ultima_tentativa_at`: timestamp
  - `resumo_contexto`: texto do resumo gerado

### 3. Criar edge function `vendas-recuperacao-cron`

Cron job que roda a cada hora e:
1. Busca contatos nas colunas elegíveis (Novo Contato, Lead, Orçamento, Qualificado) que:
   - Têm atendimento com última mensagem inbound há mais de 48h (1a tentativa) ou 72h desde última tentativa
   - `metadata.recuperacao_vendas.tentativas` < 3
2. Para cada contato elegível:
   - Se tentativas = 0: gera resumo via `summarize-atendimento`, salva no metadata
   - Envia o template correspondente à tentativa (1, 2 ou 3) via `send-whatsapp-template`
   - Incrementa contador e salva timestamp
3. Se tentativas = 3 e 72h se passaram: move para coluna "Perdidos"

### 4. Cancelar recuperação ao receber resposta

No `whatsapp-webhook/index.ts`, quando recebe mensagem inbound de um contato com `metadata.recuperacao_vendas.tentativas > 0`:
- Zera `metadata.recuperacao_vendas` (reset)
- Contato permanece na coluna atual, fluxo normal continua

### 5. Criar 3 templates na Meta

Os templates precisam ser submetidos à Meta para aprovação. Cada um recebe `{{1}}` = primeiro nome e `{{2}}` = contexto resumido da conversa.

Exemplos de corpo:

**retomada_contexto_1**: "Oi {{1}}! Estávamos conversando sobre {{2}}. Ficou com alguma dúvida? Estou aqui pra te ajudar 😊"

**retomada_contexto_2**: "{{1}}, tudo bem? Vi que a gente não terminou de conversar sobre {{2}}. Se quiser, posso te enviar mais informações ou agendar uma visita. É só me chamar!"

**retomada_despedida**: "{{1}}, passando aqui uma última vez! Se precisar de algo sobre {{2}} no futuro, é só mandar uma mensagem. Vou estar por aqui! 👋"

### 6. Registrar cron job

Agendar `vendas-recuperacao-cron` para rodar a cada hora via `pg_cron`.

## Arquivos

| Arquivo | Mudança |
|---------|---------|
| Migration SQL | Coluna "Perdidos" no pipeline de vendas |
| `supabase/functions/vendas-recuperacao-cron/index.ts` | Nova edge function de cadência |
| `supabase/functions/whatsapp-webhook/index.ts` | Cancelar recuperação ao receber inbound |
| Insert SQL (pg_cron) | Agendar cron horário |

## Resultado

- Leads inativos recebem 3 follow-ups contextuais em 7 dias pelo canal oficial
- Cada mensagem é diferente e menciona o assunto real da conversa
- Se o cliente responde, recuperação para automaticamente
- Após 3 tentativas sem resposta, card move para "Perdidos"
- Pipeline sempre limpo: nenhum card fica parado indefinidamente

