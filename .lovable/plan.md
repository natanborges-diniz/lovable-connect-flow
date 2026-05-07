## Por que o Gael não respondeu

O Gael **não respondeu nenhum cliente** (nem o Fran, nem ninguém) porque a edge function `ai-triage` está com **erro de boot** desde a última edição. Ela nem sobe — todo inbound chega no webhook, é gravado, mas o `ai-triage` falha imediatamente:

```
worker boot error: Uncaught SyntaxError:
Identifier 'detectCidadeEscolhida' has already been declared
at ai-triage/index.ts:277
```

Confirmei lendo o arquivo: a função `detectCidadeEscolhida` está declarada **duas vezes** — uma na linha 104 (correta, no bloco original com `detectAceiteVisita`/`detectRecusaVisita`/`formatLojasPorCidade`/`matchLojaEscolhida`) e outra duplicada na linha 256 (inserida sozinha, sem os outros helpers do bloco). O Deno aborta o módulo inteiro nessa colisão.

Resultado: `whatsapp-webhook` segue funcionando, `watchdog-inbound-orfao` até detectou 1 órfão, mas como o `ai-triage` não sobe, ninguém produz resposta — daí o silêncio total na conversa.

## Correção

1. **`supabase/functions/ai-triage/index.ts`** — remover a segunda declaração de `detectCidadeEscolhida` (linhas 256–264). A primeira (linha 104) é mantida e já é usada pela state machine pós-orçamento (linha 2342). Nenhuma outra função foi duplicada (verifiquei `detectAceiteVisita`, `detectRecusaVisita`, `formatLojasPorCidade`, `matchLojaEscolhida` — todas únicas).

2. **Deploy + verificação** — após salvar, conferir nos logs do `ai-triage` que sobe sem `BootFailure`. O `watchdog-inbound-orfao` (cron 1min) re-dispara automaticamente para o Fran logo após o boot voltar, então a resposta ao "Quero orçamento" sai sem ação manual.

**Arquivos tocados:** `supabase/functions/ai-triage/index.ts` (1 bloco de 9 linhas removido).

**Out of scope:** mudar a state machine pós-orçamento ou os fluxos de confirmação de receita — só destravar o boot.
