## Reclassificação de templates WhatsApp Meta: MARKETING → UTILITY

A Meta cobra três tarifas distintas: **Authentication** (mais barato, OTPs), **Utility** (mensagens transacionais sobre uma operação em curso — confirmações, status, recibos, retomada de uma conversa específica que o cliente iniciou) e **Marketing** (promoções, divulgação, reativação genérica). Hoje vários templates do Atrium estão indevidamente em MARKETING quando o conteúdo é claramente transacional (UTILITY).

### Diagnóstico atual

| Template | Cat. atual | Status | Cat. correta | Justificativa |
|---|---|---|---|---|
| `confirmacao_agendamento` | UTILITY | approved | UTILITY ✅ | Já correto |
| `lembrete_agendamento` | UTILITY | approved | UTILITY ✅ | Já correto |
| `link_pagamento_cliente` | UTILITY | rascunho | UTILITY ✅ | Já correto (será submetido) |
| `noshow_reagendamento` | MARKETING | approved | **UTILITY** | Mensagem sobre agendamento específico que o cliente já tinha — operação em curso |
| `retomada_contexto_1` | MARKETING | approved | **UTILITY** | Retomada de uma conversa/orçamento que o cliente iniciou — referência explícita ao contexto `{{2}}` |
| `retomada_contexto_2` | MARKETING | approved | **UTILITY** | Idem — continuação de tópico aberto |
| `retomada_despedida` | MARKETING | approved | **UTILITY** | Encerramento cordial de conversa específica iniciada pelo cliente |
| `despedida_cordial_v2` | MARKETING | rejected | **UTILITY** | Encerramento de atendimento — descartar (substituído por `retomada_despedida`) |
| `aviso_novo_numero_v3` | MARKETING | pending | MARKETING ✅ | Comunicado proativo sem operação em curso — Meta tende a manter como MARKETING |
| `diniz_comvocacao_*`, `diniz_vendas_comvocao` | MARKETING | approved | MARKETING ✅ | Campanha promocional |

**Observação importante sobre a Meta**: não dá para "mudar a categoria" de um template já aprovado via API. O caminho oficial é **criar uma nova versão (`_v2`, `_v3`...) com `category: UTILITY`**, submeter à Meta, e quando aprovada, apontar o código que dispara para o novo nome. O template antigo MARKETING continua existindo (não bloqueia nada) e fica como histórico até ser deletado.

### O que vai ser feito

#### 1. Criar versões UTILITY dos 4 templates mal classificados

Para cada um dos 4 templates (`noshow_reagendamento`, `retomada_contexto_1`, `retomada_contexto_2`, `retomada_despedida`), inserir um novo registro em `whatsapp_templates`:

- Nome: próximo `_vN` disponível (ex.: `noshow_reagendamento_v2`, `retomada_contexto_1_v2`, etc.)
- `categoria: 'UTILITY'`
- Mesmo `body`, `idioma`, `variaveis`, `funcao_alvo`
- `status: 'rascunho'`

Operador clica **Submeter** no painel "Templates WhatsApp (Meta)" para mandar à Meta. Em 1–24h a Meta aprova como UTILITY (tarifa muito menor por disparo).

#### 2. Apontar os crons consumidores para os novos nomes

Os arquivos que disparam cada template precisam apontar para a versão UTILITY assim que aprovada. Como o operador controla o ciclo de aprovação, a estratégia é **ler o nome do template do catálogo dinamicamente em vez de hardcoded**:

Adicionar coluna `whatsapp_templates.ativo` (boolean, default true) e função SQL `get_template_ativo(funcao_alvo, intencao)` que retorna o template aprovado mais recente para um dado uso.

Mais simples e suficiente: adicionar coluna `whatsapp_templates.substitui` (text, FK pelo nome) — quando o `_v2` UTILITY é aprovado, o operador marca `substitui = 'noshow_reagendamento'` e os crons resolvem o nome via lookup.

**Decisão proposta**: usar a abordagem direta — ajustar `agendamentos-cron`, `vendas-recuperacao-cron` e qualquer outro consumidor para chamar `send-whatsapp-template` com nomes que vêm de uma tabela de mapeamento `template_aliases` (alias lógico → nome real aprovado). Isso permite trocar versões sem redeploy.

Mapeamento inicial:
```
alias 'noshow_reagendamento'     → 'noshow_reagendamento_v2' (quando aprovado)
alias 'retomada_contexto_1'      → 'retomada_contexto_1_v2'
alias 'retomada_contexto_2'      → 'retomada_contexto_2_v2'
alias 'retomada_despedida'       → 'retomada_despedida_v2'
```

Enquanto a Meta não aprovar, o alias aponta para o nome MARKETING atual (sem quebrar nada). Quando aprovar, o operador edita o alias na UI e o cron passa a usar UTILITY automaticamente.

#### 3. Limpeza

- Marcar `despedida_cordial_v2` como descontinuado (não deletar — Meta auditoria); tirar do menu de uso.
- Adicionar coluna `descontinuado` (boolean) no catálogo para esconder no UI sem perder histórico.

#### 4. UI: WhatsAppTemplatesCard

- Mostrar **selo "UTILITY (econômico)"** em verde nos cards UTILITY e **"MARKETING (premium)"** em laranja, para o operador entender o impacto de custo.
- Adicionar aviso no formulário de criação: "UTILITY = mensagens sobre operação em curso (confirmação, status, retomada de tópico iniciado pelo cliente). MARKETING = promoções e reativação fria. UTILITY custa cerca de 5–10x menos por envio."
- Aba/filtro "Aliases" mostrando o mapeamento lógico → real, com botão para repontar quando uma nova versão é aprovada.

#### 5. Memória

Atualizar `mem://integracao/templates-whatsapp-catalogo.md` com:
- Regra: "Template novo nasce UTILITY salvo se for promoção/aviso frio."
- Tabela de aliases lógicos.
- Procedimento para repontar quando UTILITY é aprovado.

### Arquivos afetados

**Banco (migração)**:
- `whatsapp_templates`: adicionar `descontinuado boolean default false`.
- Nova tabela `template_aliases (alias text PK, template_nome text, atualizado_em timestamptz)`.
- Inserir aliases iniciais apontando aos nomes MARKETING atuais.
- Inserir 4 rascunhos UTILITY (`*_v2`).
- Atualizar `funcao_alvo` para usar alias em vez de nome direto.

**Edge functions (Atrium)**:
- `send-whatsapp-template`: aceitar `template_alias` opcional; se vier, resolve via `template_aliases` antes do gate de status.
- `agendamentos-cron`: trocar `template_name: 'noshow_reagendamento'` por `template_alias: 'noshow_reagendamento'`.
- `vendas-recuperacao-cron`: trocar 3 referências (`retomada_contexto_1/2`, `retomada_despedida`).

**Frontend Atrium**:
- `src/components/configuracoes/WhatsAppTemplatesCard.tsx`: badge UTILITY/MARKETING colorido, aviso educativo no form, seção "Aliases" com botão "Apontar para esta versão".

**Memória**:
- `mem://integracao/templates-whatsapp-catalogo.md` atualizado.

### Resultado para o usuário

- Os 4 templates de operação em curso passam a custar tarifa UTILITY (≈ 5–10x mais barato que MARKETING) assim que a Meta aprovar a v2.
- Repontamento sem redeploy: basta editar o alias na UI quando a Meta aprovar.
- UI mostra explicitamente categoria + custo estimado para evitar erro de classificação em templates futuros.
- Templates MARKETING legítimos (campanhas, aviso de novo número) seguem como MARKETING — não tudo é UTILITY.