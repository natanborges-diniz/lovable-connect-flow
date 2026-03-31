

# Plano: Sistema de Fluxos Configuráveis e Multi-Bot

## Contexto Atual

O `bot-lojas` tem 4 fluxos hardcoded (`link_pagamento`, `gerar_boleto`, `consulta_cpf`, `confirmar_comparecimento`), cada um com etapas sequenciais (valor → descrição → confirmar → executar). O menu já é dinâmico via `bot_menu_opcoes`, mas os fluxos em si não são editáveis. Além disso, o sistema suporta apenas o tipo "loja" — o usuário quer expandir para "colaborador", "cliente Lab" e outros.

## Arquitetura Proposta

```text
┌─────────────────────────────────────┐
│         bot_fluxos (tabela)         │
│  id, chave, nome, tipo_bot,        │
│  descricao, etapas (jsonb[]),       │
│  acao_final (jsonb), ativo          │
├─────────────────────────────────────┤
│  Cada etapa:                        │
│  { campo, mensagem, tipo_input,     │
│    validacao, obrigatorio }         │
│                                     │
│  Ação final:                        │
│  { tipo, coluna_destino,            │
│    tipo_solicitacao, endpoint,      │
│    template_confirmacao }           │
└─────────────────────────────────────┘
         ↑ referenciado por
┌─────────────────────────────────────┐
│  bot_menu_opcoes (existente)        │
│  + campo: fluxo_id (uuid, FK)      │
│  + campo: tipo_bot (text)           │
│    "loja" | "colaborador" |         │
│    "cliente_lab" | custom           │
└─────────────────────────────────────┘
```

## Alterações

### 1. Migração — Tabela `bot_fluxos`

Nova tabela para armazenar fluxos configuráveis:

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | uuid PK | — |
| `chave` | text unique | Identificador (ex: `link_pagamento`) |
| `nome` | text | Nome de exibição |
| `tipo_bot` | text default 'loja' | Qual bot usa: loja, colaborador, cliente_lab |
| `descricao` | text | Explicação do fluxo |
| `etapas` | jsonb | Array de etapas sequenciais |
| `acao_final` | jsonb | O que fazer ao concluir (criar solicitação, chamar API, etc.) |
| `ativo` | boolean default true | — |

Cada **etapa** no jsonb:
```json
{
  "campo": "valor",
  "mensagem": "💳 Qual o *valor*? (ex: 150.00)",
  "tipo_input": "decimal",         // decimal | texto | cpf | documento | opcao | inteiro
  "validacao": { "min": 0.01 },
  "obrigatorio": true
}
```

**Ação final**:
```json
{
  "tipo": "criar_solicitacao",       // criar_solicitacao | chamar_endpoint | apenas_mensagem
  "tipo_solicitacao": "link_pagamento",
  "coluna_destino": "Link Enviado",
  "endpoint": "payment-links",       // para fluxos que chamam API externa (OB)
  "template_confirmacao": "✅ *Link gerado!*\n🔗 {{url}}\n💰 R$ {{valor}}"
}
```

### 2. Migração — Seed dos 4 fluxos existentes

Inserir os 4 fluxos atuais (link_pagamento, gerar_boleto, consulta_cpf, confirmar_comparecimento) como registros na tabela, com suas etapas em jsonb.

### 3. Migração — Adicionar `tipo_bot` à `bot_menu_opcoes`

- `ALTER TABLE bot_menu_opcoes ADD COLUMN tipo_bot text NOT NULL DEFAULT 'loja'`
- Permite filtrar o menu por tipo de bot

### 4. Edge Function `bot-lojas/index.ts`

Refatorar para usar um **motor genérico de fluxos**:

- `loadFluxo(chave)` → busca as etapas e ação final do banco
- `processarEtapa(fluxo, etapa_atual, texto, dados)` → valida input conforme `tipo_input`, avança para próxima etapa
- `executarAcaoFinal(acao, dados, contexto)` → switch no `tipo`: criar_solicitacao, chamar_endpoint, apenas_mensagem
- Os 4 fluxos originais continuam funcionando, mas agora lidos do banco
- Fluxos com `endpoint` (link_pagamento) mantêm a lógica de chamada ao OB

### 5. Frontend — Gestão de Fluxos

Novo componente `BotFluxosCard.tsx` na tab "Lojas" de Configurações:

**Listagem:** Tabela com nome, tipo_bot, qtd etapas, ativo/inativo
**Criação/Edição (Dialog):**
- Nome e chave do fluxo
- Tipo de bot (select: loja, colaborador, cliente_lab, outro)
- Builder de etapas: lista ordenável onde cada etapa tem campo, mensagem, tipo de input e validação
- Ação final: tipo (criar solicitação / chamar endpoint / apenas mensagem), coluna destino, tipo solicitação
- Preview do fluxo (visualização sequencial das mensagens)

### 6. Frontend — Atualizar `BotMenuCard.tsx`

- Adicionar filtro por `tipo_bot` (tabs ou select no topo)
- No select de "Fluxo", carregar da tabela `bot_fluxos` filtrado por `tipo_bot` em vez de lista hardcoded
- Exibir badge com o tipo de bot em cada opção

### 7. RLS

- `bot_fluxos`: SELECT para anon e service_role, ALL para authenticated

---

## Resumo de arquivos

| Item | Tipo | Ação |
|------|------|------|
| `bot_fluxos` | Migração | Criar tabela + seed 4 fluxos |
| `bot_menu_opcoes.tipo_bot` | Migração | Adicionar coluna |
| `bot-lojas/index.ts` | Edge Function | Motor genérico de fluxos |
| `BotFluxosCard.tsx` | Componente | Criar — gestão de fluxos |
| `BotMenuCard.tsx` | Componente | Atualizar — filtro tipo_bot + fluxos do banco |
| `Configuracoes.tsx` | Página | Adicionar BotFluxosCard |

