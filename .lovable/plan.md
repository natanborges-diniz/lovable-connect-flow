

# Protocolo Sequencial Global + Comprovantes Múltiplos no Reembolso

## Resumo das Alterações

Três mudanças solicitadas:
1. **Protocolo sequencial para TODAS as solicitações** do bot (não só reembolso)
2. **Múltiplos comprovantes** no fluxo de reembolso (com loop "enviar mais?")
3. **Substituir "centro de custo"** por seleção de loja/setor no reembolso

---

## 1. Migração SQL — Protocolo Sequencial + Tabela de Anexos

```sql
-- Sequência para protocolo
CREATE SEQUENCE IF NOT EXISTS protocolo_interno_seq START 1;

-- Coluna protocolo na tabela solicitacoes
ALTER TABLE solicitacoes ADD COLUMN protocolo text UNIQUE;

-- Tabela centralizada de anexos
CREATE TABLE solicitacao_anexos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitacao_id uuid NOT NULL REFERENCES solicitacoes(id) ON DELETE CASCADE,
  tipo text NOT NULL DEFAULT 'comprovante',
  descricao text,
  storage_path text NOT NULL,
  url_publica text NOT NULL,
  mime_type text,
  tamanho_bytes bigint,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE solicitacao_anexos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can manage solicitacao_anexos"
  ON solicitacao_anexos FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access solicitacao_anexos"
  ON solicitacao_anexos FOR ALL TO service_role
  USING (true) WITH CHECK (true);
```

## 2. Atualizar dados do fluxo de reembolso (via insert tool — UPDATE)

Substituir as etapas do fluxo `reembolso`:
- **Etapa 1**: Descreva a despesa (mantém)
- **Etapa 2**: Valor total (mantém)
- **Etapa 3** (NOVA): "A despesa é de qual *loja* ou *setor*?" — tipo `selecionar_loja_ou_setor` (lista dinâmica de lojas + setores)
- **Etapa 4** (NOVA): "📎 Envie a foto/documento do comprovante" — tipo `imagem`

O campo `centro_custo` será removido e substituído por `loja_ou_setor`.

O template de confirmação será atualizado para refletir os novos campos.

## 3. Alterações no `bot-lojas/index.ts`

### 3a. Protocolo sequencial em `createFinanceiroSolicitacao`
- Após inserir a solicitação, gerar protocolo: `SOL-{ano}-{seq padded 5 dígitos}`
- Usar `nextval('protocolo_interno_seq')` via RPC ou query raw
- Atualizar a solicitação com o protocolo gerado
- Retornar o protocolo para inclusão na mensagem de confirmação

### 3b. Novo `tipo_input: "imagem"`
- No `validateInput`, adicionar case `"imagem"`: aceita quando `media_url` está presente no contexto, rejeita texto puro com mensagem "⚠️ Por favor, envie uma foto ou documento."
- Receber `media_url` e `media_mime_type` do request body (vem do webhook)

### 3c. Loop de múltiplos comprovantes
- Após receber um comprovante (imagem), o bot pergunta: "Deseja enviar *mais um comprovante*? Responda *SIM* ou *NÃO*."
- Se SIM → volta para a etapa de imagem (armazena comprovantes em array `dados.comprovantes[]`)
- Se NÃO → avança para confirmação
- Essa lógica será uma etapa especial `"aguardando_mais_comprovantes"` controlada no engine

### 3d. Etapa `selecionar_loja_ou_setor`
- Novo `tipo_input` que lista lojas ativas + setores ativos em menu numerado
- O usuário escolhe por número
- Armazena em `dados.loja_ou_setor`

### 3e. Arquivamento de comprovantes na confirmação
- Em `executarAcaoFinal`, quando `dados.comprovantes` existe:
  - Copia cada arquivo para `comprovantes/{ano}/{protocolo}/` no bucket `whatsapp-media`
  - Insere registros em `solicitacao_anexos`

### 3f. Protocolo na mensagem de confirmação
- Todas as mensagens de confirmação de todos os fluxos incluirão `📋 Protocolo: SOL-2026-XXXXX`

## 4. Alterações no `whatsapp-webhook/index.ts`

- Na função `dispatchBotLojas`, passar `media_url` e `media_mime_type` junto com o body para que o bot-lojas possa receber imagens

## 5. Interface (UI) — Solicitações

- Adicionar coluna "Protocolo" na listagem de solicitações (`Solicitacoes.tsx`)
- No hook `useSolicitacoes.ts`, incluir campo `protocolo` nas queries
- Seção de anexos com links de download quando houver comprovantes vinculados

---

## Arquivos Modificados

| Arquivo | Mudança |
|---------|---------|
| Migração SQL | Sequência, coluna `protocolo`, tabela `solicitacao_anexos` |
| `bot_fluxos` (dados UPDATE) | Etapas do reembolso: trocar centro_custo por loja/setor, adicionar comprovante |
| `supabase/functions/bot-lojas/index.ts` | Protocolo global, tipo_input imagem, loop comprovantes, seleção loja/setor |
| `supabase/functions/whatsapp-webhook/index.ts` | Passar media_url/media_mime_type ao bot-lojas |
| `src/pages/Solicitacoes.tsx` | Coluna protocolo + seção anexos |
| `src/hooks/useSolicitacoes.ts` | Incluir protocolo nas queries |

