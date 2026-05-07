## Problema (caso Emanuel)

Depois de confirmar a receita ("Sim"), a IA mandou 3 opções de lentes E **na mesma mensagem** já pediu região/bairro abertamente. O fluxo desejado é em **passos**:

1. Mostrar 3 opções de lentes.
2. Perguntar se quer **visitar a loja** pra ver pessoalmente.
3. Se sim, enviar **lista das 4 cidades** (Osasco / Carapicuíba / Itapevi / Barueri).
4. Quando cliente escolhe a cidade, listar as lojas daquela cidade e pedir pra escolher uma.
5. Aí sim, encaminhar pro fluxo de agendamento existente.

Já existem no `ai-triage` os blocos `MSG_CTA_AGENDAMENTO`, `MSG_LISTA_CIDADES` e o mapa `CIDADE_TO_LOJAS` (linhas 67–78), mas nunca são usados. O fluxo atual cai no LLM, que improvisa "Em qual região/bairro você está?" no fim do orçamento.

## Regra final

Depois que o gate `receita_confirmacao` marca `pending=false` (cliente disse "Sim"), o `ai-triage` entra em **máquina de estados determinística** controlada por `contatos.metadata.pos_orcamento`:

```
{ etapa: "orcamento_enviado" | "aguardando_cta_visita" | "aguardando_cidade" | "aguardando_loja",
  cidade?: "osasco" | "carapicuiba" | "itapevi" | "barueri",
  loja_nome?: string,
  iniciado_at: ISO }
```

Transições:

| Estado entrada | Trigger | Saída IA | Próximo estado |
|---|---|---|---|
| sem estado, `confirmed_at` recém-setado | (mesmo turno da confirmação) | dispara `consultar_lentes` (ou `consultar_lentes_contato` p/ LC), formatador remove o sufixo "Em qual região/bairro?" e troca por `MSG_CTA_AGENDAMENTO` | `aguardando_cta_visita` |
| `aguardando_cta_visita` | inbound = "sim/quero/pode/bora/vamos/pode sim/topa" | `MSG_LISTA_CIDADES` | `aguardando_cidade` |
| `aguardando_cta_visita` | inbound = "não/agora não/depois" | resposta curta de despedida amigável + libera LLM normal | limpa estado |
| `aguardando_cidade` | inbound contém match de cidade (Osasco/Carapicuíba/Itapevi/Barueri, com fuzzy) | lista as lojas daquela cidade (de `telefones_lojas` filtrando pelos nomes em `CIDADE_TO_LOJAS[cidade]`), formatadas com endereço e horário do dia | `aguardando_loja` |
| `aguardando_cidade` | qualquer outra coisa | re-envia `MSG_LISTA_CIDADES` (1×); na 2ª devolve pro LLM | mantém / limpa |
| `aguardando_loja` | inbound casa nome/número de uma das lojas listadas | grava `metadata.pos_orcamento.loja_nome` + dispara fluxo de agendamento existente (LLM com hint forçando `agendar_visita` naquela loja, dia/hora a perguntar) | limpa estado |

## Mudanças

### `supabase/functions/ai-triage/index.ts`

**a) Helpers novos (próximo às linhas 67–78):**

- `detectAceiteVisita(text)` regex `/^(sim|claro|quero|topo|topa|pode|pode sim|bora|vamos|gostaria|aceito|👍|👌|✅)\b/i` (com filtro de "não").
- `detectRecusaVisita(text)` regex `/^(n[ãa]o|agora\s*n[ãa]o|depois|fica\s*pra\s*depois|s[oó]\s*orcamento)\b/i`.
- `detectCidadeEscolhida(text)` → casa contra chaves de `CIDADE_TO_LOJAS` (normalizando acentos/maiúsculas; aceita "1/2/3/4" se a lista foi numerada).
- `formatLojasPorCidade(cidade, lojas)` → monta string numerada `1️⃣ DINIZ ANTONIO AGU — Rua X, 100 (hoje 09–18)\n2️⃣ ...`.

**b) Bloco pós-confirmação (~linha 2101–2102):**

Quando o gate libera (`pending=false` recém-setado, dentro da faixa, contexto óculos/LC), antes de seguir pro LLM, gravar:

```ts
contatoMeta.pos_orcamento = { etapa: "orcamento_enviado", iniciado_at: new Date().toISOString() };
await supabase.from("contatos").update({ metadata: contatoMeta }).eq("id", contatoId);
```

E injetar um system-hint forte no prompt do turno: "Cliente acabou de confirmar a receita. AÇÃO: chame `consultar_lentes` (ou `consultar_lentes_contato`) AGORA. NÃO pergunte região/bairro/cidade. Termine SOMENTE com a frase exata: '{MSG_CTA_AGENDAMENTO}'." (já há infraestrutura de hint nas linhas ~2725–2752.)

**c) Pós-processamento da resposta da tool `consultar_lentes`/`consultar_lentes_contato` (no formatador, linhas ~4982 e equivalente em LC):**

Substituir o sufixo atual `"Posso te indicar a loja mais próxima pra você ver pessoalmente e fechar a melhor opção? Em qual região/bairro você está? 😊"` por `"\n\n" + MSG_CTA_AGENDAMENTO`. E, no caller que envia, depois de mandar a quote, atualizar `metadata.pos_orcamento.etapa = "aguardando_cta_visita"`.

**d) Curto-circuito determinístico no início do `serve` (logo após o bloco de confirmação ~linha 2147):**

```ts
const posOrc = contatoMeta.pos_orcamento;
if (posOrc?.etapa === "aguardando_cta_visita" && !lastIsImage) {
  if (detectAceiteVisita(lastInboundText)) { send(MSG_LISTA_CIDADES); set etapa="aguardando_cidade"; return; }
  if (detectRecusaVisita(lastInboundText))  { send("Tranquilo! Quando quiser ver pessoalmente, é só me chamar 😊"); clear; return; }
  // qualquer outra coisa → libera LLM (mantém estado por 1 turno só)
}
if (posOrc?.etapa === "aguardando_cidade" && !lastIsImage) {
  const c = detectCidadeEscolhida(lastInboundText);
  if (c) { send(formatLojasPorCidade(c, lojas)); set etapa="aguardando_loja", cidade=c; return; }
  // 1ª vez não reconhecida → re-envia MSG_LISTA_CIDADES; 2ª vez → libera LLM
}
if (posOrc?.etapa === "aguardando_loja" && !lastIsImage) {
  const loja = matchLoja(lastInboundText, CIDADE_TO_LOJAS[posOrc.cidade], lojas);
  if (loja) { grava loja_nome; injeta hint pra LLM rodar agendar_visita com loja_nome=loja; clear pos_orcamento.etapa="agendando"; }
  // não reconhecida → re-envia lista; na 2ª libera LLM
}
```

**e) Eventos:** `pos_orcamento_iniciado`, `cta_visita_aceito`, `cta_visita_recusado`, `cidade_escolhida`, `loja_escolhida`, `pos_orcamento_fallback_llm`.

**f) Watchdog (`watchdog-loop-ia/index.ts`):** mensagens iguais a `MSG_LISTA_CIDADES` e `formatLojasPorCidade` não contam como loop (regex `^Boa! Atendemos nessas cidades` e `^Beleza! Aqui são as lojas`).

### Memória

- Atualizar `mem://ia/auto-receita-e-anti-loop.md` com o caso Emanuel e a máquina de estados.
- Adicionar entrada nova `mem://ia/fluxo-pos-confirmacao-receita.md` (curta) descrevendo a transição.

## Out of scope

- Mudar o fluxo de agendamento em si (continua usando `agendar_visita`).
- Outros cenários onde o cliente pula direto pra cidade sem confirmar receita (continua via LLM).
- Dashboard/UX de auditoria desse funil.

## Arquivos tocados

- `supabase/functions/ai-triage/index.ts`
- `supabase/functions/watchdog-loop-ia/index.ts`
- `.lovable/memory/ia/auto-receita-e-anti-loop.md`
- `.lovable/memory/ia/fluxo-pos-confirmacao-receita.md` (novo)
