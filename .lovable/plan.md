## Por que OS de "aguardando armação" não aparecem no painel

A bridge devolveu 11 OS entre 17–19/jun, mas nenhuma virou disparo. O cron `regua-disparo-aguardando-armacao` faz, em sequência:

1. Pega o telefone do cliente vindo da bridge.
2. Procura em `contatos` por esse telefone.
3. Se **não acha** → `continue` silencioso. Não envia WhatsApp, **não grava em `os_avisos_armacao_log`**, então o painel `/relatorios/disparos` nem como falha consegue mostrar.

Causa raiz dupla:
- **(a)** O telefone vem em formato diferente do que está salvo (com/sem 9º dígito, com/sem DDI 55, com máscara).
- **(b)** O cliente realmente nunca foi cadastrado em `contatos` (nunca conversou no WhatsApp).

Também ficou claro que **23–25/jun** não tiveram OS processadas porque a bridge Firebird está retornando HTTP 500 (mesmo erro afeta entregas e aniversariantes). Quando voltar, o catch-up dinâmico processa sozinho.

## O que vai ser feito

### 1. Normalizar telefone antes de buscar (cobre causa A)
Em `regua-disparo-aguardando-armacao`, criar helper `normalizarTelefoneBR(raw)` que:
- Remove tudo que não é dígito.
- Tira DDI `55` do início se houver.
- Garante 9º dígito em celulares (DDD + 9 + 8 dígitos).
- Devolve sempre no formato canônico `5582999991234`.

Aplicar em duas pontas:
- No telefone vindo da bridge antes do `WHERE`.
- Nova função SQL `match_contato_por_telefone(raw text)` que normaliza o lado do banco também (lida com cadastros antigos sujos).

### 2. Criar contato a partir do payload da bridge se ainda não achar (cobre causa B)
Se mesmo após normalização não houver contato, fazer `upsert` em `contatos` com:
- `telefone` = telefone normalizado
- `nome` = `cliente_nome` da bridge
- `origem` = `'bridge_os_armacao'`
- `created_at` = `now()`

Usa `ON CONFLICT (telefone) DO UPDATE SET nome = COALESCE(contatos.nome, EXCLUDED.nome)` — não sobrescreve nome existente, só preenche se estiver vazio.

Depois disso o cron segue o fluxo normal: cria atendimento, envia template, grava em `os_avisos_armacao_log` com `status='sent'`. A OS vira disparo visível e o cliente entra no Cliente 360 a partir desse primeiro contato.

### 3. Tornar falhas visíveis no painel
Mesmo com 1 + 2, podem sobrar casos de telefone inválido (5 dígitos, número fixo, lixo). Para esses, ao invés de `continue` mudo:
- Inserir em `os_avisos_armacao_log` com `status='telefone_invalido'`, `payload={ raw_phone, motivo }`.
- `vw_disparos_unificados` passa a expor esse status na fonte `armacao`.
- `DisparoStatusBadge.tsx` ganha variante âmbar "Telefone inválido" com tooltip explicando.
- Linha não tem botão "Abrir conversa" (não há atendimento).

### 4. Backfill manual dos 3 dias perdidos
Depois que (1)+(2)+(3) estiverem em produção **e** a bridge Firebird voltar, abrir `/configuracoes/bridge-saude` e clicar nas células de 17, 18 e 19/jun para reprocessar. O cron vai criar os contatos faltantes e disparar os 11 avisos retroativos. Sem migration automática — depende da bridge externa.

### 5. Bridge HTTP 500 (23–25/jun)
Fora do escopo do app (problema no serviço Firebird). O painel `/configuracoes/bridge-saude` já mostra vermelho. Posso, opcionalmente, incluir o corpo do erro retornado pela bridge na notificação aos admins para acelerar o diagnóstico do time de infra — diga se quer essa parte.

## Arquivos afetados

- `supabase/functions/regua-disparo-aguardando-armacao/index.ts` — helper de normalização + upsert de contato + log `telefone_invalido`.
- Migration nova — função SQL `match_contato_por_telefone(text)` e recriação de `vw_disparos_unificados` para incluir o novo status na fonte `armacao`.
- `src/components/relatorios/DisparoStatusBadge.tsx` — variante "Telefone inválido".
- `src/pages/RelatorioDisparos.tsx` — filtro novo + tooltip + esconder botão "Abrir conversa" quando não há atendimento.

## O que não vou mexer

- Lógica de outros crons (entregas, aniversários) — eles têm o mesmo padrão mas só corrijo se você pedir, para não inflar o escopo.
- Bridge Firebird em si.
- Reprocessamento automático quando contato for criado depois manualmente — fica como follow-up.