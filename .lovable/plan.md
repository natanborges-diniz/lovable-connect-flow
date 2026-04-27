## Objetivo

Adicionar um botão **"Reconectar (+24h)"** no painel do atendimento que aparece automaticamente quando a última mensagem inbound do cliente foi há mais de 24h, permitindo escolher e disparar um template aprovado (ex: `retomada_contexto_1`) com 1 clique, sem precisar sair da tela.

## Comportamento

1. **Detecção automática**: ao abrir um atendimento, calculamos `horasDesdeUltimoInbound`. Se for > 24h (ou se não há nenhum inbound), o botão aparece destacado na toolbar com badge âmbar "+24h".
2. **Clique no botão** → abre um Popover com:
   - Lista de templates aprovados filtrados por categoria (`MARKETING` para retomada).
   - Sugestões priorizadas: `retomada_contexto_1`, `retomada_contexto_2`, `retomada_despedida`, `noshow_reagendamento`.
   - Campo para preencher o nome do cliente (auto-preenchido com `contato.nome` quando disponível).
   - Pré-visualização do corpo do template com variáveis substituídas.
3. **Confirmar envio** → chama `send-whatsapp-template` com `contato_id`, `template_name`, `template_params`, `language: 'pt_BR'`.
4. **Feedback**: toast de sucesso/erro. A mensagem aparece no chat via realtime (já está logada como `outbound` pelo edge function existente).
5. **Pós-envio**: mostra dica "Aguarde o cliente responder para reabrir a janela de 24h".

## Componentes

- **Novo**: `src/components/atendimentos/ReconectarTemplateButton.tsx`
  - Props: `atendimentoId`, `contatoId`, `contatoNome`, `ultimoInboundAt`
  - Internamente busca templates aprovados via `supabase.from('whatsapp_templates').select(...).eq('status','approved')`
  - Renderiza Popover + Select de template + Input de nome + Button "Enviar"
- **Editado**: `src/pages/Atendimentos.tsx`
  - Calcula `ultimoInboundAt` a partir de `mensagens` (último item com `direcao === 'inbound'`)
  - Renderiza `<ReconectarTemplateButton />` na toolbar de ações (linha ~339, junto com Resumo IA e Demandas) quando `>24h`

## Diagrama de fluxo

```text
Atendimento aberto
       │
       ▼
horas desde último inbound?
       │
   ┌───┴───┐
   ≤24h   >24h
   │      │
   │      ▼
   │   Botão "Reconectar (+24h)" visível
   │      │ clique
   │      ▼
   │   Popover: escolher template + nome
   │      │ confirmar
   │      ▼
   │   send-whatsapp-template (gate aprovado ✓)
   │      │
   │      ▼
   │   Meta envia template → janela 24h reabre
   │      │
   │      ▼
   └── Cliente responde → texto livre liberado
```

## Detalhes técnicos

- Sem mudança de schema. Usa tabelas/funções existentes: `whatsapp_templates`, edge function `send-whatsapp-template`.
- Reutiliza o gate já implementado no edge function (bloqueia envio se `status != approved`).
- O cálculo de "+24h" é client-side (`Date.now() - new Date(ultimoInboundAt).getTime() > 86_400_000`), refletindo a mesma regra do `send-whatsapp`.
- Templates listados filtram por `status='approved'` e ordenam priorizando os de retomada por nome (`retomada_*`, `noshow_*`).
- Feedback toast via `sonner` (padrão do projeto).
- Acessibilidade: Popover do shadcn já cuida de ARIA.

## Fora de escopo

- Não adiciona disparo automático (a cadência CRM Anti-Abandono já cobre isso para colunas configuradas).
- Não cria novos templates — usa só os já aprovados na Meta.
- Não altera o gate de 24h no `send-whatsapp` (continua bloqueando texto livre fora da janela, como deve ser).