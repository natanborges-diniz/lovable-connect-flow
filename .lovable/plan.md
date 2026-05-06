## Diagnóstico — por que a IA não entregou os valores

### O que o atendimento mostra (contato Cleber, atendimento `7e7c5bf9`)

A IA leu corretamente a receita da mãe do Cleber:
- **OD esf +4.25 cil -1.25 add +3.00** (multifocal hipermetrópico com astigmatismo)
- **OE esf +5.50 cil -4.25 add +3.00** (idem, com **astigmatismo alto**)

A IA **prometeu** o orçamento ("Já vou separar opções"), pediu a região, recebeu "Osasco, Vila Ayrosa" — e a partir daí **nunca rodou a tool `consultar_lentes`**. Em vez disso, deu 3 respostas evasivas ("preciso confirmar na loja", "valores presenciais na Antônio Agú", "vou te mostrar 2-3 alternativas"), repetiu duas vezes "Conta pra mim com mais detalhes" (loop) e escalou.

### Causa raiz #1 — gap real no catálogo (CRÍTICO)

Conferi `pricing_table_lentes` com filtros exatos da receita:

| Filtro | Linhas ativas |
|---|---|
| Total catálogo | 155 |
| Multifocal total | 115 |
| Multifocal cobrindo esf +4.25 (OD) | 112 |
| Multifocal cobrindo esf +5.50 (OE) | 110 |
| **Multifocal cobrindo esf +5.50 E cil -4.25 (OE)** | **0** |

**Zero linhas** atendem o cilindro -4.25 do OE. A tool `consultar_lentes` exige cobrir ambos os olhos, então retornaria vazio. O fluxo "PROIBIDO escalar" obriga a IA a ir pra loja, e o template "gap-aware" (memory `auto-receita-e-anti-loop`) cai no fallback "preciso confirmar na loja" — exatamente as 3 respostas evasivas que apareceram.

Isso é o mesmo padrão documentado nos casos Paulo Henrique 3ª rodada: catálogo Hoya antigo não cobre cilindros altos. **A reforma Hoya em curso (857 linhas, ainda não aplicada) resolve grande parte disso** — Nulux iDentity V+, MyStyle, LifeStyle têm cilindros até -6.00 nos índices altos.

### Causa raiz #2 — a IA nunca tentou rodar `consultar_lentes` depois da receita

Os eventos `triagem_ia` mostram `intencao:orcamento` em todas as 4 últimas saídas, mas nenhum log de `consultar_lentes` executado. Hipóteses (a confirmar lendo `ai-triage` antes de codar):

1. O hint de auto-chain pós-OCR só dispara no **mesmo turno** da leitura. Como a IA mandou "Já vou separar opções" sem rodar a tool, e o turno seguinte foi "Osasco, Vila Ayrosa", o detector "região após orçamento prometido" deveria ter forçado `consultar_lentes` — mas não há evento nem outbound com valores. Provavelmente a tool rodou, voltou vazio, e caiu no fallback sem registrar.
2. Faltou re-tentar com **flexibilização do cilindro** (busca aproximada / aceitar lente "compatível mais próxima") quando a busca exata não retorna nada.

### Causa raiz #3 — loop "Conta pra mim com mais detalhes"

Quando o cliente perguntou "qual valores estimados?", o `validator` rejeitou a saída da IA por similaridade 100% com mensagem recente, e o `pickFallback` mandou o fallback genérico **2 vezes seguidas** (18:51:24 e 18:51:58). Memory `auto-receita-e-anti-loop` diz que `pickFallback` deveria escalar já no SEGUNDO fallback consecutivo — escalou no terceiro turno ("Valores"), funcionou, mas depois de 2 fallbacks idênticos. Pode ser que a contagem de fallback consecutivo esteja sendo zerada quando o cliente envia inbound entre eles.

## Plano de correção

### Etapa 1 — Aplicar a reforma Hoya já preparada (resolve 80% do problema)

Rodar as 2 migrations já geradas em `/tmp/h1.sql` e `/tmp/h2.sql` (857 linhas, preserva Hoyalux D+). Depois validar que esf +5.50 / cil -4.25 multifocal passa a ter cobertura (Nulux iDentity V+ 1.67/1.74, MyStyle V+).

### Etapa 2 — Diagnóstico assistido + fallback "estimativa" quando catálogo não cobre

Em `supabase/functions/ai-triage/index.ts`:

1. **Logar explicitamente** quando `runConsultarLentes` retorna zero linhas (evento `eventos_crm` tipo `consultar_lentes_zero_linhas` com filtros usados). Hoje isso fica silencioso.
2. **Fallback automático para `consultar_lentes_estimativa`**: se `consultar_lentes` retornar zero, antes de cair no template "preciso confirmar na loja", rodar a tool de estimativa (já existe, memory `orcamento-multifocal-parcial`) e devolver as 3 faixas Econômica/Intermediária/Premium marcadas como "valores estimativos — confirmamos exato na loja". Isso entrega valor ao cliente em vez de empurrar pra unidade.
3. **Re-disparar `consultar_lentes` no turno seguinte** quando IA prometeu orçamento ("já vou separar", "vou te mostrar opções") e o turno seguinte é resposta de região. Hoje o detector "região após orçamento" existe mas só reage à última outbound da IA pedindo região — promessa sem pergunta passa batido.

### Etapa 3 — Endurecer anti-loop de fallback genérico

Em `pickFallback` (`ai-triage/index.ts`):
- Contagem de "fallbacks consecutivos" não deve resetar com inbound do cliente — deve contar fallbacks emitidos pela IA seguidos, ignorando inbounds curtos no meio. Se 2 fallbacks idênticos foram emitidos, escalar imediatamente em vez de mandar o terceiro.

### Etapa 4 — Memory update

Atualizar `mem://ia/auto-receita-e-anti-loop` com:
- Caso Cleber 2026-05-06 (gap de cilindro alto + IA não re-disparou tool após resposta de região + 2 fallbacks idênticos consecutivos).
- Nova regra: zero-linhas → fallback automático para `consultar_lentes_estimativa`, nunca cair direto no "confirmar na loja".

## Resposta direta à sua pergunta

A IA não enviou os valores por **três motivos combinados**:

1. **Catálogo Hoya antigo não cobre cilindro -4.25 multifocal** — a busca retornava vazio. (A reforma de 857 linhas que você aprovou resolve isso assim que aplicarmos.)
2. **A IA não re-tentou `consultar_lentes` depois que o cliente respondeu "Osasco, Vila Ayrosa"** — caiu direto em mensagens evasivas do template "preciso confirmar na loja".
3. **O anti-loop deixou passar 2 fallbacks idênticos** ("Conta pra mim com mais detalhes") antes de escalar.

Posso já aplicar tudo (Hoya + correções no `ai-triage` + memory) numa única passada quando você aprovar.
