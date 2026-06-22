## Reconciliação D+1 do cashback — fluxo final

### Princípio inegociável

**Cliente final não é notificado em momento algum** sobre reconciliação, divergência ou ajuste. Toda a comunicação ao cliente continua a do ato da venda: validação do PIN + mensagem amigável de boas-vindas ao cashback (saldo, validade, como usar). Os ajustes de D+1 são silenciosos: o saldo mostrado no extrato simplesmente sai de "provisório" para "disponível" quando a confirmação ocorre.

### Estado atual

- Edge function `regua-reconciliacao` pronta (consulta bridge, calcula `valor_status`, chama `cashback_confirmar_credito`, seta âncora).
- RPC `cashback_confirmar_credito` move provisório → confirmado.
- **Não há cron agendado** (3 inscrições paradas).
- **Não há fluxo de tratamento de divergência** (loja + gestor).

### Fluxo definitivo aprovado

```text
Loja lança venda  ──►  PIN ao cliente (única comunicação)
                       crédito PROVISÓRIO + inscrição "aguardando_entrega"
                          │
        cron 07:00 SP ────┤   (único, diário)
                          ▼
         regua-reconciliacao consulta bridge por nº venda + empresa
                          │
        ┌─────────────────┼──────────────────┐
        ▼                 ▼                  ▼
   valor = informado   valor diverge     venda não existe
   (tol R$ 0,50)       > tolerância       no Firebird
        │                 │                  │
   APROVA AUTO        demanda interna    tentativas++;
   status=confirmado  para a LOJA via    após 5x → notifica
   (silencioso        Messenger Atrium   supervisor; status
   p/ cliente)        (silencioso        = sem_venda_persistente
                       p/ cliente)
                          │
        ┌─────────────────┼──────────────────┐
        ▼                 ▼                  ▼
   Loja: "Ajustar    Loja: "Manter     Sem resposta em
   p/ valor sistema" lançado"          24h → escala
        │             (precisa             gestor (mesma
   confirma com       aprovação do          UI de auditoria)
   valor Firebird     supervisor)
```

Em **nenhum** dos ramos sai mensagem ao cliente. O cliente só vê seu saldo virar "disponível" no extrato/atendimento — sem texto, sem template, sem push.

### Mudanças necessárias

**1. Cron único — 07:00 SP (10:00 UTC) diário**
- `regua-reconciliacao-diaria` chamando a edge function. Sem outro disparo.

**2. Edge function `regua-reconciliacao` — ajustes**
- `valor_status='ok'`: confirma automaticamente + emite evento `cashback_confirmado` na timeline (interno).
- `valor_status='divergente'`: NÃO confirma; cria demanda interna `cashback_divergencia` para a loja `cod_empresa` com `{ valor_sistema, valor_lancado, inscricao_id, numero_venda }`; push + notificação Atrium aos vendedores; evento `cashback_divergente` (interno). **Nenhum template WhatsApp ao cliente.**
- `sem_venda`: incrementa `tentativas_reconciliacao`; após 5x marca `sem_venda_persistente` + notifica supervisor (interno).
- Guard explícito no código: comentário e helper que confirma que toda chamada de envio é `mensagens_internas` / `notificacoes`, nunca `send-whatsapp*`.

**3. Migration**
- `regua_inscricao`: + `tentativas_reconciliacao int default 0`, + `ultima_tentativa_at timestamptz`, + `demanda_divergencia_id uuid`.
- Convenção `tipo_chave='cashback_divergencia'` em `demandas_loja`.

**4. RPCs novas (security definer)**
- `cashback_aprovar_divergencia(_inscricao_id, _valor_aceito, _origem, _motivo)` — confirma silenciosamente; fecha demanda; grava `metadata.origem_decisao` (`loja_ajustou_sistema` / `loja_manteve_lancado` / `supervisor_override`). Não dispara nada ao cliente.
- `cashback_cancelar_inscricao(_inscricao_id, _motivo)` — estorna provisório silenciosamente.

**5. UI — loja (Messenger / DemandaThreadView)**
- Card `cashback_divergencia` com os 2 valores e 2 botões:
  - "Ajustar para sistema (R$X)" → aprova na hora com `_origem='loja_ajustou_sistema'`.
  - "Manter lançado (R$Y)" → marca demanda aguardando supervisor.

**6. UI — gestor (`/regua` → nova aba "Auditoria de Cashback")**
- Filtros: divergentes pendentes, pedidos de override, `sem_venda_persistente`.
- Ações: Aprovar sistema / Aprovar lançado / Cancelar / Reprocessar.
- Acesso por `user_acessos.cashback_auditoria` (admin/supervisor).

**7. Memória**
- `.lovable/memory/contatos/cashback-d1-auditoria.md`: cron 07h, aprovação automática silenciosa, demanda Atrium em divergência, **regra dura: nenhuma comunicação ao cliente durante reconciliação** — única mensagem ao cliente é o PIN no ato da venda + saldo no extrato.

### Arquivos previstos

- `supabase/migrations/<ts>_cashback_auditoria.sql`
- Cron agendado via `supabase--insert`
- `supabase/functions/regua-reconciliacao/index.ts` (ramo divergência → demanda interna)
- `src/pages/CashbackAuditoria.tsx` + entrada no menu Régua
- `src/components/cashback/AuditoriaDivergencias.tsx`
- `src/components/atendimentos/DemandaThreadView.tsx` (render `cashback_divergencia`)
- `src/hooks/useCashbackAuditoria.ts`
- `.lovable/memory/contatos/cashback-d1-auditoria.md`

### Resposta direta

Tudo blindado em backstage: cron 07h, aprovação automática quando bate, demanda interna à loja em divergência, supervisor como fallback — e nenhuma mensagem ao cliente em nenhum desses passos.