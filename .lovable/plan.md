
# Correções na conversa "Fran" — 3 falhas distintas

A análise da conversa + dados no banco mostrou três problemas independentes que precisam ser corrigidos em conjunto. O ponto crítico que conecta tudo: **a tool `agendar_cliente` nunca foi disparada**, então o agendamento de 06/05 15:00 no Super Shopping **nunca foi persistido na tabela `agendamentos`** (consultei: zero linhas para o telefone 5584994244323).

Sem registro, todo o sistema de "agendamento ativo / despedida com `Te espero {data}` / proibição de remarcar" cai por terra — daí a IA, na retomada da manhã, inventar "segunda-feira, 04/05 às 17:30 na DINIZ ANTONIO AGU".

---

## Problema 1 — IA continua fazendo perguntas em série após o agendamento confirmado

**O que aconteceu:** Após o cliente dizer "Eu já marquei!!" e a IA reafirmar 06/05 15:00 Super Shopping, ela emendou 8 perguntas seguidas (estilo, cor, material, tamanho, plaquetas, filtro azul, ajudar em mais alguma, etc.). O usuário quer que, **logo após a confirmação do cliente, a IA se despeça e só volte a interagir se o cliente trouxer assunto novo**.

**Causa raiz:** o ROUTER de "armações/modelos" (linha 1750) já faz convite presencial — mas, quando o cliente diz "Pode separar modelos" depois do agendamento estar fechado, ele entra no ROUTER de novo, gera resposta nova ("Ray-Ban, Oakley… Antônio Agú / União / Super") e ali a IA volta a perguntar "qual loja". A partir daí cada resposta curta da Fran ("Gatinho", "Dourado", "Metal fino", "Delicado", "Sem") vira um turno LLM normal — o guardrail `[AGENDAMENTO ATIVO]` (linha 2613) só dispara se `hasAgendamentoAtivo=true`, que é falso (nada na tabela).

**Correções:**
1. **Persistir o agendamento de fato (root cause)** — ver Problema 3.
2. No ROUTER de armações (linhas 1750-1778), se já existir agendamento ativo na tabela `agendamentos`, **substituir a resposta padrão** por: `"Já está tudo certo, {nome}! Te espero {data} {hora} na {loja} — vou separar modelos pra você provar lá no balcão. Qualquer dúvida é só me chamar 👋"` e marcar `armacoes_orientado=true` para o próximo turno cair no guardrail de "preferência registrada" e não em pergunta nova.
3. Adicionar nova flag `isPostAgendamentoSilenceMode` em `ai-triage`: ativada quando (a) há agendamento ativo na tabela, (b) último outbound da IA já contém uma das frases canônicas de despedida (`Te espero`, `Combinado`, `Foi um prazer`), (c) cliente respondeu curto (≤3 palavras) ou outra mensagem sem novo intent claro (sem perguntas, sem palavras-chave de preço/produto/remarcar).
   - Quando ativa: bloqueia o LLM, não envia nada (silêncio total — fica logado como `[POS-AGENDAMENTO-SILENCIO]`).
   - Só sai desse modo se o cliente trouxer **novo intent**: pergunta com "?", palavras-chave (`preço`, `valor`, `remarcar`, `cancelar`, `endereço`, `como chegar`, `vai ter…`, foto, áudio, pergunta sobre receita).

## Problema 2 — Na retomada da manhã, a IA "modificou" o agendamento

**O que aconteceu:** templates `retomada_contexto_1` foram disparados. Cliente respondeu "Não". A IA finalizou com `"Combinado, Fran! Te espero segunda-feira, 04/05 às 17:30 na DINIZ ANTONIO AGU"` — data/loja **inexistentes** (alucinação pura — não há esse registro em `agendamentos`).

**Causa raiz:** sem agendamento persistido, o bloco `agendamentoFmt` (linhas 2240-2248) ficou vazio, mas o LLM, vendo no histórico "te espero quarta 06/05 15:00 Super Shopping", deveria ter usado isso. Em vez disso, alucinou uma data antiga. Pior: **o despedida do `[FLUXO DESPEDIDA PÓS-AGENDAMENTO]` (linha 2351) usa `agendamentoFmt` vazio como fallback `"Qualquer coisa estou por aqui"`** — mas o LLM ignorou o template literal e chutou uma data.

**Correções:**
1. Tornar a despedida pós-agendamento **determinística** (não passa pelo LLM). Quando `isThanksClose || isShortNoToHelp || isExplicitClose` for true, em vez de só injetar instrução system e deixar o LLM responder, gerar a string final em código e enviar via `sendWhatsApp` direto, dando `return jsonResponse(...)` antes de chamar o LLM. Isso elimina qualquer alucinação de data/loja.
2. A string usa **exclusivamente** `agendamentoFmt` da query da tabela `agendamentos`. Se não houver agendamento ativo, despedida sem data: `"Combinado, {nome}! Qualquer dúvida é só me chamar 👋"` — proibido o LLM tentar reconstruir do histórico.
3. Adicionar regra explícita no prompt do LLM (quando ele for de fato chamado): "PROIBIDO citar data/horário/loja de agendamento que não esteja na seção AGENDAMENTOS ATIVOS abaixo. Se a seção estiver vazia, NÃO mencione nenhuma data específica na despedida."

## Problema 3 — Agendamento nunca persistido (root cause de tudo)

**O que aconteceu:** Quando a IA disse "ficou reagendado para quarta, 06/05, às 15:00 na loja do Super Shopping Osasco" (22:21), ela **não chamou a tool `agendar_cliente`**. Confirmei consultando `mensagens.metadata->'tool'` para o atendimento — nenhuma com `agendar_cliente`. A frase com card "📍 Agendamento confirmado" foi gerada como texto puro pelo LLM, sem persistência.

**Causa raiz:** o LLM julgou que estava só "reafirmando" um agendamento e não disparou a tool. Não há guardrail que force a tool quando há loja+data+hora explícitas na fala da IA mas nenhuma linha em `agendamentos`.

**Correções:**
1. **Detector pós-resposta**: depois do LLM gerar a resposta, se o texto contém `Agendamento confirmado` / `te esperamos` / `ficou (re)agendado` + extrai data + hora + nome de loja, e **não há linha em `agendamentos`** com essa data para esse contato, disparar `agendar-cliente` em background com os dados extraídos. Idempotente (a EF já tem proteção anti-duplicação por mem `agendamento-ativo-anti-duplicacao`).
2. Adicionar regex de extração: `/(?:quarta|terça|segunda|quinta|sexta|sábado|domingo|amanhã|hoje)?,?\s*(\d{2}\/\d{2})(?:\/\d{2,4})?,?\s*(?:às\s*)?(\d{1,2}[h:]\d{0,2})/` + match de loja contra `telefones_lojas.loja_nome`.
3. Reforçar no prompt do LLM: "Se você está prestes a CONFIRMAR um agendamento (data+hora+loja), você DEVE chamar a tool `agendar_cliente` ANTES — mesmo que esteja apenas reafirmando o que o cliente acabou de dizer. NUNCA prometa data/hora sem persistir."

---

## Arquivos a alterar

| Arquivo | Mudança |
|---|---|
| `supabase/functions/ai-triage/index.ts` | (a) Router armações com guardrail de agendamento ativo (~1760); (b) flag `isPostAgendamentoSilenceMode` + early return silencioso; (c) despedida pós-agendamento determinística (não-LLM) com early return; (d) detector pós-LLM que dispara `agendar-cliente` se texto contém promessa de data/hora/loja sem persistência; (e) regra anti-alucinação de data no system prompt. |
| `.lovable/memory/ia/pos-agendamento-silencio.md` (novo) | Documentar o modo de silêncio pós-agendamento e o detector de tool não-disparada. |
| `.lovable/memory/index.md` | Adicionar referência ao novo memory + atualizar Core com "Pós-agendamento: silêncio total até cliente trazer novo intent". |
| `.lovable/memory/ia/agendamento-ativo-anti-duplicacao.md` | Acrescentar "Detector pós-LLM auto-dispara agendar_cliente se IA confirmar data/hora/loja sem chamar a tool." |

---

## Não vou tocar

- Tool `agendar_cliente` em si (lógica idempotente já está OK, ver memory).
- Cron jobs / templates de retomada.
- Fluxo do ROUTER de armações para clientes **sem** agendamento ativo (continua igual).

## Como validar depois

1. Cliente novo agenda visita → checar linha em `agendamentos` (regression test).
2. Cliente confirma agendamento → IA manda despedida → cliente diz "obg" → **silêncio** (sem nova mensagem).
3. Cliente fala "Pode separar modelos" depois de confirmado → IA reafirma agendamento + "vou separar pra você provar lá", sem nova bateria de perguntas.
4. Retomada do dia seguinte: se cliente disser "não" no template, despedida usa `agendamentoFmt` real OU genérico — nunca data inventada.
