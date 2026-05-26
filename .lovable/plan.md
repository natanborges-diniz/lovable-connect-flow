## Diagnóstico do caso Dany

Cronologia + por que cada balão extra escapou:

| # | Cliente | IA respondeu | Causa |
|---|---------|--------------|-------|
| 1 | "Sim" (confirma agendamento) | "…Precisa de mais alguma coisa antes da visita?" | Esperado — pergunta de fechamento canônica (`askedHelpMore`). |
| 2 | **"Só isso mesmo"** | "…**Precisa de algo antes de vir?**" | `SHORT_NO_RE` (linha 4276) só casa `só isso` / `era só isso` exatos — **não casa "só isso mesmo"**. Cai no LLM normal, que devolveu nova pergunta. |
| 3 | (sem inbound) | "…Até já 👋" | Provável reenvio do mesmo turno (LLM retry / merge resposta+proximo_passo). |
| 4 | **"Ok"** | "Conta pra mim com mais detalhes…" + depois "Após o exame, você prefere já olhar armações…?" | `"ok"` **não está** em `isThanksOnly` (linha 4268) **nem** em `SHORT_NO_RE`. Sem despedida determinística. Gate de **silêncio pós-agendamento** (linha 4487) exige que o último outbound contenha `qualquer dúvida é só me chamar` ou `qualquer coisa estou por aqui` + 👋. As despedidas anteriores foram "Precisa de algo antes de vir?" e "Até já 👋" — **nenhuma bate a assinatura canônica**, então o silêncio não ativou e o LLM gerou retomada genérica + oferta de comparativo (proibida pós-agendamento). |

Resumo: três regexes restritivas demais permitiram que mensagens triviais de encerramento ("só isso mesmo", "ok") furassem todas as camadas (despedida determinística → silêncio pós-agendamento → guardrail).

## Correções propostas em `supabase/functions/ai-triage/index.ts`

1. **Ampliar `SHORT_NO_RE` (linha 4276)** para cobrir variantes comuns de "estou ok":
   - adicionar: `só isso mesmo`, `só isso então`, `era isso`, `era isso mesmo`, `nada mais`, `nada por enquanto`, `por agora não`, `ok`, `okay`, `ok então`, `tá ok`, `tá bom`, `ta bom`, `blz`, `beleza`, `tudo certo então`, `tudo certinho`, `perfeito`, `combinado`.

2. **Ampliar `isThanksOnly` (linha 4268)** para tratar `"ok"`, `"okay"`, `"blz"`, `"beleza"`, `"combinado"` como agradecimento puro quando há agendamento ativo — assim `isThanksClose` dispara despedida determinística em vez de cair no LLM.

3. **Ampliar regex de "despedida canônica" do gate de silêncio pós-agendamento (linha 4487)** para reconhecer também as variações já usadas pelo LLM:
   - `te espero (hoje|amanhã|...)`, `te aguardamos`, `até já`, `até daqui a pouco`, `nos vemos`, `combinado!.*(te espero|te aguardamos)`.
   - Manter exigência de 👋 OU término sem `?` para evitar false positives. Assim, mesmo que a despedida saia sem a assinatura "qualquer dúvida…", o silêncio ativa no turno seguinte.

4. **Bloquear oferta de comparativo / "olhar armações vs. receita" pós-agendamento** no hint pré-LLM já existente (memory `agendamento-ativo-anti-duplicacao`): garantir que a lista de proibições inclua perguntar "prefere armações ou retirar a receita?" quando `hasAgendamentoAtivo && !explicitChange`. Hoje a regra cobre região/preço, mas a pergunta de pós-exame ainda passou.

5. **Não enviar `proximo_passo` interrogativo no caminho `isShortNo` (não-ToHelp)** quando o último outbound já é despedida + agendamento ativo: tratar como `isShortNoToHelp`. Isso elimina o "Precisa de algo antes de vir?" do turno 2.

6. **Anti-duplicação de despedida**: já existe (`_despedidaJaEnviada`) — adicionar à lista de assinaturas canônicas `"te espero hoje"`, `"até já 👋"`, `"te aguardamos"` para suprimir o reenvio observado no turno 3.

## Verificações pós-correção

- Logs de `ai-triage` no atendimento da Dany devem mostrar:
  - turno "Só isso mesmo" → `[CLOSE] thanksClose=false shortNoToHelp=true → DESPEDIDA determinística`.
  - turno "Ok" → `[POS-AGENDAMENTO-SILENCIO] silenciando` OU `isThanksClose=true` → despedida única.
- Nenhum evento `eventos_crm.tipo='despedida_duplicada_evitada'` é necessário porque o silêncio bloqueia antes.

## Atualizações de memória

- `mem://crm/fluxo-encerramento-atendimento` — adicionar variantes "só isso mesmo", "ok", "beleza" à tabela `isShortNoToHelp` / `isThanksClose`.
- `mem://ia/pos-agendamento-silencio` — registrar que o gate aceita também "te espero …", "te aguardamos", "até já 👋" como despedida canônica.

## Fora de escopo
- Sem mudanças de UI, sem alteração de prompt do LLM além do hint pré-LLM existente.
- Sem migração SQL.
