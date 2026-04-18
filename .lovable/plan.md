
Confirmado: demandas pra loja são B2B interno → nunca usar Meta Official. Forçar canal não-oficial (Evolution) sempre.

## Plano

### 1. `supabase/functions/send-whatsapp/index.ts`
- Aceitar `force_provider` no body. Se vier, ignora `canal_provedor` do atendimento e usa o forçado.

### 2. `supabase/functions/criar-demanda-loja/index.ts`
- Ao chamar `send-whatsapp` pra loja, sempre passar `force_provider: 'evolution_api'`.
- Garantir que o atendimento da loja (criado se não existir) já nasça com `canal_provedor='evolution_api'` pra respostas futuras roteiarem certo.

### 3. `supabase/functions/encaminhar-demanda-cliente/index.ts`
- Não mexer — encaminhamento ao cliente segue o provedor do atendimento do cliente (correto).

### 4. Diagnóstico da Loja Teste (rodar no default mode)
- SQL: `telefones_lojas` Loja Teste + última msg da demanda #1 + atendimento da loja (qual `canal_provedor` tá gravado).
- Se atendimento da loja foi criado como `meta_official`, atualizar pra `evolution_api`.

### 5. Status visível no `DemandaLojaPanel`
- Badge no card da demanda mostrando provedor usado + se houve erro de envio (lê `mensagens.metadata` da última outbound).

## Resultado
Toda demanda → loja sai pelo Evolution (não-oficial), sem dependência de janela 24h Meta. Loja Teste recebe no próximo envio se o número for WhatsApp ativo no Evolution.
