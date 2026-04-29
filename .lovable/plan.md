
## Como funciona hoje (Messenger, sem bot)

A loja abre `/nova-demanda` no app InFoco Messenger. A página `LojaNovaDemanda.tsx` lê `bot_fluxos.etapas[]` no Supabase compartilhado e renderiza um **wizard de formulário** (não é bot conversacional). Cada etapa vira um campo do form (Input, Textarea, select de loja, upload de imagem/PDF). Ao enviar, chama a edge function `criar-solicitacao-loja`, que grava em `solicitacoes` (Atrium) com tipo correspondente. CPF aprovado é tratado pelo Financeiro no `CpfApprovalDialog` do Atrium.

## Objetivo

No fluxo "Gerar Boleto" do Messenger, **substituir os campos `cpf`, `cliente`, `valor` por uma seleção de uma Consulta de CPF previamente aprovada**. A loja não digita mais esses dados — ela escolhe da lista. Sem CPF aprovado disponível, o wizard bloqueia e oferece atalho para abrir a Consulta de CPF.

Tudo continua aterrissando em `solicitacoes` exatamente como antes (mesmo `tipo`, mesmo payload, mesmo Pipeline Financeiro). Muda apenas a UX de captura.

## UX no Messenger (`/nova-demanda` → Gerar Boleto)

1. Loja entra no fluxo "Gerar Boleto".
2. Em vez do form atual com 4 campos, aparece primeiro um **bloco "CPF aprovado"**:
   ```
   Selecione o CPF aprovado para este boleto

   ◯ João Silva — 123.***.***-45
     R$ 1.000,00 · aprovado em 28/04
   ◯ Maria Souza — 987.***.***-32
     R$ 2.500,00 · aprovado em 27/04
   ```
3. Ao escolher, os campos `cpf`, `cliente` e `valor` ficam **pré-preenchidos e travados** (read-only com badge "do CPF aprovado"). Continua editável só `descricao`.
4. Botão **Enviar** habilita normalmente; o submit envia o mesmo payload já existente para `criar-solicitacao-loja`, agora com `consulta_cpf_id` em `dados`.
5. **Lista vazia** (nenhum CPF aprovado elegível): mostra card de bloqueio:
   ```
   Para gerar boleto é preciso ter uma Consulta de CPF
   aprovada pelo financeiro.

   [ Solicitar Consulta de CPF ]   [ Voltar ]
   ```
   Botão leva direto ao fluxo `consulta_cpf` (já existente no menu) sem perder a navegação.

## Regras de elegibilidade (lista de CPFs aprovados)

Mostrar `solicitacoes` que satisfaçam TODAS:
- `tipo = 'consulta_cpf'`
- `metadata->>'resultado_consulta' = 'aprovado'`
- Mesma loja (filtro por `metadata->>'loja_nome'` igual ao `lojaNome` do contexto, ou `contato_id` da loja quando disponível)
- `created_at` nos últimos 60 dias
- Sem boleto já vinculado: `metadata->>'boleto_solicitacao_id' IS NULL`

## Vínculo entre as duas solicitações

Ao criar o boleto, gravamos em ambos os lados (auditoria nas duas pontas):

- Boleto novo → `metadata.consulta_cpf_id`, `metadata.cpf`, `metadata.nome_cliente`, `metadata.valor_aprovado` herdados.
- Consulta CPF original → `metadata.boleto_solicitacao_id`, `metadata.boleto_gerado_at`. Isso impede reuso e o `CpfApprovalDialog` mostra "Boleto já gerado em DD/MM".

## Mudanças técnicas

Tudo no projeto **InFoco Messenger** (front) + **edge function compartilhada**. Nada de bot.

**1. `src/pages/LojaNovaDemanda.tsx` (Messenger)**
- Detectar quando `fluxoAtivo.chave === 'gerar_boleto'`.
- Antes de renderizar etapas, fazer query em `solicitacoes` com as regras acima e guardar `cpfsAprovados[]` em estado.
- Se vazio: renderizar card de bloqueio com botão que navega ao fluxo `consulta_cpf` (carrega via `entrar()` com a `MenuOpcao` correspondente).
- Se há lista: renderizar `<RadioGroup>` no topo, e ao escolher, popular `dados.cpf`, `dados.cliente`, `dados.valor` e marcar essas etapas como "lockadas" (passar prop para o render mostrar Input `readOnly` + badge).
- Adicionar `dados.consulta_cpf_id` ao payload.

**2. `supabase/functions/criar-solicitacao-loja/index.ts` (compartilhada)**
- Quando `fluxo_chave === 'gerar_boleto'` e `dados.consulta_cpf_id` presente:
  - Validar (server-side) que a consulta existe, é aprovada e está sem boleto vinculado.
  - Após criar a solicitação de boleto, fazer `update` na consulta CPF original gravando `metadata.boleto_solicitacao_id` e `metadata.boleto_gerado_at` (merge no JSONB).
  - Se a validação falhar, retornar `{ error: "..." }` com mensagem clara.

**3. `bot_fluxos.gerar_boleto`** (apenas data update — uso da insert tool, sem migração)
- Remover campos `cpf`, `cliente`, `valor` das `etapas[]`. Manter só `descricao`. Os outros valores virão da Consulta selecionada.

**4. `src/components/financeiro/CpfApprovalDialog.tsx` (Atrium)**
- Mostrar pequeno badge "✅ Boleto já gerado em DD/MM" quando `metadata.boleto_solicitacao_id` existir, evitando reaproveitamento manual.

## Fora de escopo

- Não muda fluxo `consulta_cpf` em si.
- Não altera schema/RLS — toda regra usa `metadata` JSONB já existente em `solicitacoes`.
- Validade de 60 dias hardcoded inicialmente (pode virar `configuracoes_ia` depois).
- Decisão estrita: filtra por `loja_nome` da loja logada. Se uma rede precisar reaproveitar consulta entre filiais, fica para evolução.

## Risco / nota

Como este projeto (Atrium) não pode editar o Messenger, parte 1 e 2 (front + edge function) precisam ser executadas no projeto InFoco Messenger. Apenas o passo 3 (data update no `bot_fluxos`) e o passo 4 (`CpfApprovalDialog`) são executados aqui no Atrium após aprovação.
