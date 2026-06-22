## Auditoria: Cashback D+1 + Consulta OS — pode liberar?

### Resposta direta
**Ainda não.** Roteador de OS e a infra de reconciliação estão prontos e os templates Meta `aviso_aguardando_armacao` e `os_recebida_loja` já estão **aprovados**, mas há 3 pontas soltas que quebram silenciosamente em produção. Plano abaixo corrige cada uma sem mexer no que já funciona.

### O que está OK (verificado)
- **Cron único 07:00 SP** (`regua-reconciliacao-diaria-07h-sp`, schedule `0 10 * * *`) ativo. Sem cron extra de meio-dia.
- **Cron 07:00 SP aguardando armação** (`regua-disparo-aguardando-armacao`) também ativo.
- **Templates Meta aprovados** (`os_recebida_loja` → `os_recebida_loja_v2`, `aviso_aguardando_armacao` → `aviso_aguardando_armacao_v2`).
- **Roteador `ai-triage`** detecta `consulta_os` antes do LLM, escala para humano, move card para coluna "Consulta de OS", trava pedido de receita/orçamento. Keywords editáveis em `configuracoes_ia.os_intent_keywords` populadas.
- **UI auditoria gestor** (`/regua/auditoria`) e **card de divergência** no `DemandaThreadView` plugados.
- **RPCs `cashback_aprovar_divergencia` / `cashback_cancelar_inscricao`** existem e são silenciosas ao cliente.

### Gaps que bloqueiam produção

**1. Divergência de cashback nunca chega à loja (bug bloqueante)**
`regua-reconciliacao` chama `criar-demanda-loja` com a service role key, mas `criar-demanda-loja` faz `supabase.auth.getUser(token)` e devolve **401 Unauthorized** quando o token não é JWT de usuário. Resultado: na primeira divergência real a demanda nunca é criada, a inscrição fica `valor_status='divergente'` órfã e nenhuma loja é avisada.

**2. `loja_nome` enviado é o `cod_empresa` (ex.: `"18"`)**
`resolver_destinatarios_loja(_loja_nome)` casa pelo nome textual da loja — passar o código numérico devolve lista vazia, então mesmo se o passo 1 fosse corrigido, **0 destinatários** seriam notificados via Messenger/push.

**3. Loja não tem como confirmar recebimento de OS no Messenger**
A edge function `confirmar-recebimento-os` (preview + confirm) está pronta e dispara o template aprovado, mas **nenhum componente em `src/` a chama**. Sem botão/tela, o template `os_recebida_loja` nunca sai, quebrando a régua de OS.

### Correções (escopo cirúrgico)

```text
A. supabase/functions/criar-demanda-loja/index.ts
   ├─ aceitar header "x-service-call: 1" + body.solicitante_nome
   │  → pula auth.getUser(), grava solicitante_id=NULL, solicitante_nome="Sistema"
   └─ continua exigindo JWT para chamadas do frontend (default)

B. supabase/functions/regua-reconciliacao/index.ts (criarDemandaDivergencia)
   ├─ resolver loja_nome real: lookup em lojas_cidades por loja_id=cod_empresa
   │  (fallback: telefones_lojas; último recurso: "Loja {cod_empresa}")
   ├─ adicionar header "x-service-call: 1" + solicitante_nome:"Reconciliação cashback"
   └─ log explícito quando destinatários=0 (para auditoria)

C. Frontend — confirmar recebimento de OS
   ├─ novo componente src/components/os/ConfirmarRecebimentoOSDialog.tsx
   │  - input nº OS → action="preview" mostra cliente/loja/produto
   │  - botão "Confirmar recebimento" → action="confirm"
   ├─ ponto de entrada: botão no Messenger (página /mensagens) visível
   │  para usuários com user_acessos.menu_loja=true
   └─ toast de sucesso + refetch da lista de OS pendentes

D. Memória
   └─ atualizar mem://regua/os-aguardando-armacao-e-recebimento-loja:
      templates já aprovados (sair de "rascunho") + entrada UI no Messenger.
```

### Smoke test antes de liberar (sem migration, sem cron novo)
1. Inserir 1 `regua_inscricao` fake com `cod_empresa='18'`, valor divergente, rodar `regua-reconciliacao` manualmente → confirmar demanda criada, destinatários>0, push chegando, **nenhum** registro em `mensagens` (WhatsApp ao cliente).
2. Loja clica "Ajustar para sistema" → confirmar `cashback_credito.valor` recalculado, `valor_status='ok'`, demanda fechada, **nenhum** WhatsApp ao cliente.
3. Loja clica "Manter lançado" → demanda fica aguardando supervisor; gestor abre `/regua/auditoria` e aprova; verificar evento `cashback_confirmado` interno.
4. No Messenger, abrir o novo diálogo de OS com um nº real → preview retorna cliente, confirmar dispara `os_recebida_loja_v2` (idempotente: 2ª chamada devolve `already_received`).

### Arquivos previstos
- `supabase/functions/criar-demanda-loja/index.ts` (bypass service)
- `supabase/functions/regua-reconciliacao/index.ts` (resolver loja_nome + header service)
- `src/components/os/ConfirmarRecebimentoOSDialog.tsx` (novo)
- `src/pages/Mensagens.tsx` (botão de entrada)
- `.lovable/memory/regua/os-aguardando-armacao-e-recebimento-loja.md` (status templates)

### Recomendação
Aplicar A→D, rodar o smoke test, **aí sim** liberar produção. Os 3 itens são pequenos e independentes; sem eles o fluxo aparenta funcionar mas falha no primeiro caso real (divergência presa, loja não confirma OS).
