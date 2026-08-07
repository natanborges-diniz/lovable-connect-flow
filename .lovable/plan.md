# Por que a chave envelheceu — e como impedir que volte a acontecer

## O que foi verificado agora

Todos os agendamentos do banco (`cron.job`) guardam a chave de API **escrita à mão dentro do comando SQL**, uma cópia por job (hoje são ~15 jobs, cada um com o token colado no header `Authorization`/`apikey`).

Consequência: quando as chaves do projeto foram rotacionadas (fim de julho), cada cópia virou um token morto. Não existe nenhum ponto único de atualização, nem alarme — o job continua "rodando" a cada minuto, recebe 401 e ninguém percebe. Foi exatamente o caso do vigia de inbound órfão, parado de 29/07 até ontem.

Ou seja: a causa não é a rotação em si (rotacionar é correto), é a **duplicação do segredo em 15 lugares sem monitoramento**.

## Como resolver de forma definitiva

### 1. Um único lugar guarda a chave
Criar uma tabela interna de configuração (sem acesso público) com a chave atual e uma função SQL `chamar_edge_function(nome, corpo)` que monta o `net.http_post` lendo a chave desse lugar.

### 2. Reescrever os ~15 jobs para usarem a função
Cada job passa a ser uma linha: `select chamar_edge_function('watchdog-inbound-orfao', '{}')`. Nenhum token dentro do comando. Em uma futura rotação, basta atualizar **uma** linha e todos os jobs voltam ao normal.

### 3. Alarme de job quebrado
Novo job de monitoramento (a cada 15 min) que lê as respostas HTTP das últimas horas (`net._http_response`) e, se encontrar qualquer chamada de função com status 401/403/5xx, cria notificação para o admin no Atrium (mesmo canal já usado pelo aviso de bridge fora do ar). Assim, uma chave vencida aparece em minutos, não em semanas.

### 4. Painel de saúde dos crons
Na página de saúde já existente, uma seção listando cada job: último disparo, último status HTTP e há quanto tempo não retorna 200 — verde/amarelo/vermelho.

### 5. Regra permanente
Registrar na memória do projeto: nenhuma chave literal em `cron.job`; toda rotação de chave é seguida de atualização do registro único e verificação do painel.

## Detalhes técnicos

- Tabela `app_config` (chave/valor, RLS negando tudo; acesso só via função `security definer`).
- Função `public.chamar_edge_function(fn text, body jsonb default '{}')` — `security definer`, monta URL a partir do project ref e envia `Authorization: Bearer <chave>` + `apikey`.
- Migration reescreve os jobs existentes com `cron.schedule` (mesmo nome/schedule, comando novo).
- Monitor: edge function `watchdog-crons` + job de 15 min, agregando `net._http_response` join `net.http_request_queue` por URL de função.
- Sem alteração de comportamento das funções em si; só a forma de chamá-las.
