# Crons à prova de rotação de chave — autocorreção sem admin

## O que foi verificado agora

1. Todos os ~15 agendamentos em `cron.job` têm a chave de API **colada dentro do comando SQL**, uma cópia por job. Rotacionou a chave → 15 cópias mortas de uma vez, sem aviso.
2. Existe ainda uma segunda cópia obsoleta: `app_config` guarda `SUPABASE_SERVICE_ROLE_KEY` (valor `sb_secret_OE…`, gravado em 23/04, anterior à rotação). Ou seja, hoje há duas fontes de chave desatualizadas no banco.

Enquanto o segredo viver dentro do banco, sempre haverá algo para desatualizar. A solução robusta é o cron **não precisar de chave nenhuma**.

## Estratégia: remover a dependência da chave (autocorreção real)

### 1. Chamada de função sem token rotacionável
As edge functions do projeto rodam com `verify_jwt = false`, então o header `Authorization` com a chave publishable/service não é o que as protege. Substituir esse header por um segredo interno próprio (`INTERNAL_SERVICE_SECRET`, já usado na integração da bridge) enviado como `x-service-key`, validado dentro da função. Esse segredo é nosso, não é tocado por nenhuma rotação de chaves do backend.

Resultado: rotacionar chaves do projeto deixa de derrubar qualquer cron.

### 2. Uma função única de disparo
`public.chamar_edge_function(nome, corpo)` monta a URL e o header lendo o segredo de um único registro. Cada job vira uma linha só, sem token no comando. Se um dia o segredo interno precisar mudar, muda em um lugar e todos os jobs seguem.

### 3. Autocorreção (sem humano no meio)
Novo job `watchdog-crons` a cada 10 min:
- lê as respostas HTTP recentes (`net._http_response`) por job;
- se um job acumulou falhas (401/403/5xx ou nenhuma resposta) nas últimas execuções, ele **se reescreve sozinho**: reagenda o job pela `chamar_edge_function` com o segredo atual e dispara uma execução imediata de recuperação;
- registra o conserto em log de eventos.

Ou seja, mesmo que alguém recrie um job antigo com token colado, o watchdog normaliza sozinho no próximo ciclo.

### 4. Rede de segurança do próprio watchdog (quem vigia o vigia)
O watchdog também pode quebrar — então ele não depende só de si mesmo:
- **Heartbeat**: cada execução grava `ultimo_ok` em `cron_jobs`. Uma função SQL agendada por `pg_cron` (execução puramente dentro do banco, sem HTTP e portanto sem chave) verifica os heartbeats; se o watchdog estiver mudo por mais de 30 min, ela mesma reescreve os jobs a partir do registro único.
- **Alerta escalonado**, só depois da tentativa de conserto: notificação no Atrium + push + WhatsApp interno para o administrador (canal que não exige alguém olhando o painel).
- Limpeza da chave obsoleta em `app_config`, para não restar cópia velha.

### 5. Painel (apoio, não dependência)
Na página de saúde, uma seção com cada job: última resposta HTTP, último 200 e conserto automático aplicado. Serve para auditoria — a correção não depende de alguém abrir a tela.

## Detalhes técnicos

- `public.chamar_edge_function(fn text, body jsonb default '{}')`, `security definer`, header `x-service-key` a partir de `app_config` (chave `INTERNAL_SERVICE_SECRET`), sem `Authorization`.
- Migration reescreve os jobs existentes mantendo nome e schedule.
- Guard nas edge functions alvo: aceitar `x-service-key` válido (as que já usam esse padrão ficam iguais).
- `watchdog-crons` (edge function + job 10 min) agrega `net._http_response` × `net.http_request_queue` por URL, aplica `cron.schedule` corretivo e loga em `eventos_crm`.
- Supervisor SQL puro (`pg_cron`, 15 min) chamando função `reparar_crons()` — sem HTTP, imune a qualquer problema de chave/rede.
- Sem mudança de comportamento das funções de negócio.
