## Painel de Disparos CRM (`/relatorios/disparos`) — admin-only

Tela única consolidando **todo disparo outbound originado pelo CRM**, com status Meta (sent / delivered / read / failed / invalid_number), motivo de falha e atalho para a conversa do cliente. Acesso restrito a admin por enquanto; configurável depois.

### Escopo de fontes (cobertura completa)

| Fonte | Origem técnica | Como entra na view |
|---|---|---|
| **Aguardando armação** | `os_avisos_armacao_log` | direto |
| **Régua pós-venda** (primeiro contato, adaptação 7d, aniversário, NPS) | `regua_touchpoint` | direto |
| **Cashback** (PIN de validação, confirmação de crédito, lembrete de resgate, divergência) | `mensagens` outbound com `metadata.template_name` ∈ catálogo cashback **+** eventos `cashback_credito` | join por `whatsapp_message_id` |
| **Entrega de óculos** (aviso "pronto p/ retirar" via `confirmar-recebimento-os`, OS recebida na loja, retirada confirmada) | `mensagens` outbound com `metadata.template_name` ∈ `{os_recebida_loja, oculos_pronto_retirar, …}` **+** `os_recebimento_loja` | join + linha própria |
| **Link de pagamento** (envio, lembrete, confirmação) | `pagamentos_link` + `pagamentos_link_eventos` | direto |
| **Agendamento** (confirmação, lembrete véspera/1h, no-show, reativação) | `mensagens` outbound com template do catálogo de agendamento | direto |
| **Recuperação / retomada IA** (`retomada_contexto_*`, `recuperacao_lead`, etc.) | `mensagens` outbound flag template | direto |
| **Escalada / aviso loja** (notificar-loja-agendamento, demandas) | `mensagens` outbound + `notificacoes` | direto |
| **Texto livre IA/operador** dentro da janela 24h | `mensagens` `direcao='outbound'` sem template | **opt-in** no filtro (off por padrão) |

Critério: **se saiu do CRM para o cliente final via WhatsApp, aparece aqui.** A fonte é classificada pela tabela de origem ou pelo `metadata.template_name` (alias mapeado em `template_aliases` → grupo: `armacao | regua | cashback | entrega | pagamento | agendamento | recuperacao | escalada | outro`).

### Backend

1. **View `vw_disparos_unificados`** (SECURITY INVOKER, read-only) unindo as fontes acima e normalizando:
   - `id`, `fonte` (grupo), `template_nome`, `alias`, `cliente_nome`, `telefone`, `loja_nome`, `atendimento_id`, `contato_id`, `enviado_at`, `wa_status`, `wa_status_at`, `falha_motivo`, `params`.
   - `wa_status` derivado de `mensagens.metadata.last_status` (sent/delivered/read/failed/invalid_number) quando há `whatsapp_message_id`; senão usa o status próprio da fonte (`os_avisos_armacao_log.status`, `pagamentos_link.status`, etc.).
2. **RPC `disparos_kpis(periodo_dias int, fontes text[])`** → entrega %, leitura %, resposta-em-24h %, número inválido %, total enviados.
3. **Acesso**: `GRANT SELECT` só a `authenticated`; view + RPC checam `has_role(auth.uid(),'admin')`. Demais roles não leem nada agora.
4. **Config**: chave `disparos_painel` em `app_config`:
   ```json
   { "fontes_ativas": ["armacao","regua","cashback","entrega","pagamento","agendamento","recuperacao","escalada"],
     "incluir_texto_livre_default": false,
     "periodo_default_dias": 7 }
   ```
   Lida pela tela; edição via UI de configurações fica para próxima entrega.

### UI

- Rota `/relatorios/disparos` em `App.tsx` dentro de `<ProtectedRoute allowedRoles={["admin"]}>`.
- Link no `AppSidebar` (grupo Configurações / Relatórios — só admin enxerga).
- Topo: 4 cards KPI (entrega, leitura, resposta 24h, inválido) + filtros (período, fonte, template, loja, status, busca telefone/nome).
- Tabela paginada: data | cliente+fone | loja | fonte/template | status (ícones tipo `MessageTicks`: ⏱ → ✓ → ✓✓ → ✓✓ azul; ✗ vermelho) | motivo falha | botão "Abrir conversa" → `/crm/conversas?atendimento=<id>`.
- Toggle "incluir mensagens de texto livre" (default = config).
- Export CSV do conjunto filtrado.

### Fora do escopo desta entrega
- Visão por loja/supervisor (acesso restrito a admin agora).
- Série temporal por campanha / reenvio em lote.
- Tela de edição da chave `disparos_painel` (estrutura já fica pronta).

### Arquivos
- **Migration**: `vw_disparos_unificados`, RPC `disparos_kpis`, grants admin-only, chave `disparos_painel` em `app_config`.
- **Novos**: `src/pages/RelatorioDisparos.tsx`, `src/hooks/useDisparos.ts`, `src/components/relatorios/DisparoStatusBadge.tsx`.
- **Editar**: `src/App.tsx` (rota protegida), `src/components/layout/AppSidebar.tsx` (link admin).
