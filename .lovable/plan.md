## Problema

Hoje, quando um atendimento é escalado para humano, o `vendas-recuperacao-cron` **pula** o card (linhas 149-184 de `vendas-recuperacao-cron/index.ts`) e apenas gera uma notificação interna de inatividade. Resultado: se o operador escala mas não responde, ou responde uma vez e o cliente some, **nenhuma retomada é disparada para o cliente** — o card fica parado na fila humana indefinidamente.

Adicionalmente, fora da janela de 24h da Meta, mensagem livre não pode ser enviada — só template aprovado (`retomada_contexto_1`, `retomada_contexto_2`, `retomada_despedida` já estão `approved` no catálogo).

## Solução

Estender a cadência de recuperação para **também cobrir contatos em modo humano**, usando templates Meta aprovados (compatíveis com janela >24h) e respeitando o trabalho do consultor (cooldown quando há resposta humana recente).

### Cadência humano (nova)

Disparada por `vendas-recuperacao-cron` para cards `modo='humano'` em colunas elegíveis do CRM:

| Fase | Quando | Ação | Canal |
|---|---|---|---|
| Alerta interno | 6h sem resposta do cliente após handoff | Notificação ao operador (já existe, manter) | in-app |
| 1ª retomada | **24h** sem resposta do cliente E sem outbound humano nas últimas 24h | Template `retomada_contexto_1` ({{1}}=primeiro_nome, {{2}}=tópico inferido da última msg humana) | WhatsApp Meta |
| 2ª retomada | **48h** após a 1ª (sem resposta) | Template `retomada_contexto_2` | WhatsApp Meta |
| Despedida | **24h** após a 2ª (sem resposta) | Template `retomada_despedida` + encerra atendimento + move para Perdidos + remove flag humano | WhatsApp Meta |

Total: ~96h do silêncio até Perdidos no fluxo humano (mais lento que o IA, pois assume que houve atendimento real e o consultor pode estar conduzindo offline).

### Regras de segurança

1. **Cooldown humano**: já existente (linhas 200-227). Se houver outbound de remetente humano nas últimas 24h, **pula a retomada** — assume que o consultor está conduzindo. Aplicar a mesma lógica para o modo humano.
2. **Só templates aprovados**: a função `send-whatsapp-template` já bloqueia disparos não-aprovados (gate via `whatsapp_templates.status`).
3. **Inferência de tópico ({{2}})**: extrair da última mensagem outbound humana (ex: "seu orçamento", "sua visita", "as lentes de contato"). Fallback: `"seu atendimento"`. Implementação simples: regex sobre últimas 5 outbound humanas para palavras-chave (orçamento, visita, lentes, óculos, agendamento); senão usa fallback.
4. **Contador separado**: salvar `recuperacao_humano: { tentativas, ultima_tentativa_at }` em `atendimentos.metadata` (não usar o mesmo contador do fluxo IA que vive em `contatos.metadata.recuperacao_vendas`).
5. **Despedida humano**: ao encerrar, registra `eventos_crm` tipo `lead_despedida_humano` e move card para coluna "Perdidos" do CRM.
6. **Exclusão de corporativos**: já filtrado pelo bloco `isCorporate` do webhook + filtro `tipo='cliente'` da fila humana. Manter.

### Botão manual "Reconectar" (já existe)

O componente `ReconectarTemplateButton.tsx` já permite ao operador disparar template manualmente quando passa de 24h. Manter como ferramenta de fallback. A automação acima cobre o caso "operador esqueceu".

### UI / Config

- Adicionar à `CronJobsCard` os parâmetros do payload do `vendas-recuperacao-cron`:
  - `humano_delay_hours: [24, 48]` (padrão)
  - `humano_final_wait_hours: 24` (padrão)
  - `humano_max_tentativas: 2` (padrão)
- Configurações → Agendamentos Automáticos passa a exibir bloco "Recuperação Humano" separado de "Recuperação IA".

## Arquivos a editar

- `supabase/functions/vendas-recuperacao-cron/index.ts` — adicionar branch para modo humano (entre linhas 148-184), com cadência via `send-whatsapp-template`, contador em `atendimentos.metadata.recuperacao_humano`, despedida e move para Perdidos.
- `.lovable/memory/crm/recuperacao-ia-anti-abandono.md` — documentar a nova cadência humano paralela à IA.
- (opcional) `src/components/configuracoes/CronJobsCard.tsx` — expor os 3 novos parâmetros.

Sem mudanças de schema. Sem novos templates (os 3 existentes cobrem). Sem mudanças no `send-whatsapp-template`.
