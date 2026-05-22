## Contexto rápido (para alinhar)

Hoje, no Atrium:
- **Quem pede exceção:** apenas o Financeiro, pelo botão "Solicitar autorização de exceção" dentro do `CpfApprovalDialog` (aparece quando o card está Reprovado ou Dados Incompletos).
- **Loja:** não pede exceção. Só recebe o retorno read-only via `solicitacao_comentarios.tipo='retorno_setor'` + push.
- **Documento da consulta (o "score"):** é o mesmo arquivo que o Financeiro anexa no momento de aprovar/reprovar — fica em `solicitacao.metadata.documento_url` (bucket `cpf-documentos`).

Problema: o Financeiro pode hoje clicar em "Solicitar autorização de exceção" **sem ter anexado o documento da consulta**, e o autorizador recebe o pedido cego, sem o material que justifica a análise.

## Solução proposta

Manter a arquitetura atual (só Financeiro pede; só Aprovar/Rejeitar do lado do autorizador) e adicionar **bloqueio prévio + transporte do documento até o autorizador**.

### 1. Bloqueio prévio no `CpfApprovalDialog`

No bloco que renderiza o botão "Solicitar autorização de exceção" (linhas 410-420):

- Se `meta.documento_url` **estiver presente** → botão habilitado normalmente.
- Se **não estiver** → botão fica desabilitado, com tooltip e bloco explicativo logo acima:
  > "Para pedir exceção é obrigatório anexar o documento da consulta (score). O autorizador precisa avaliar o material antes de decidir."
  
  Junto, mostrar um mini-uploader inline ("Anexar documento da consulta") que grava direto em `solicitacao.metadata.documento_url` (mesmo storage path que o fluxo de Aprovar/Reprovar já usa) e, assim que sobe, libera o botão.

Isso reaproveita 100% o `handleFileChange` + `documento_url` que já existem; nenhuma coluna nova.

### 2. Transporte do documento até o autorizador

No `SolicitarAutorizacaoDialog.handleEnviar`:

- Antes do `insert` em `autorizacoes_excecao`, ler `meta.documento_url` do `contexto` (já está sendo passado pelo `CpfApprovalDialog`, basta adicionar o campo).
- Persistir em dois lugares para o autorizador encontrar:
  - `autorizacoes_excecao.contexto.documento_url` (já passa por `contexto`, é só incluir).
  - No corpo da mensagem 1-a-1 (`mensagens_internas.conteudo`): adicionar uma linha "📎 Documento da consulta anexado" — e no `metadata.kind=autorizacao_excecao` já existente, o card visual da mensagem (`AutorizacaoExcecaoCard`) ganha um botão **"Ver documento"** que abre signed URL do bucket `cpf-documentos`.

### 3. Card do autorizador (`AutorizacaoExcecaoCard`)

Adicionar botão "Abrir documento da consulta" que:
- Chama `supabase.storage.from('cpf-documentos').createSignedUrl(path, 600)` com o path vindo de `metadata.contexto.documento_url`.
- Abre em nova aba.
- Se o documento não estiver presente (casos antigos), mostra aviso vermelho "⚠️ Pedido sem documento anexado" — para deixar evidente para o autorizador que aquele caso antigo veio sem score.

### 4. Lado da loja — sem mudança funcional

Confirmado: loja segue recebendo apenas o retorno read-only. Se discordar do resultado, pode:
- Abrir uma nova solicitação de consulta CPF com dados corrigidos (fluxo já existente).
- Mandar mensagem ao Financeiro pelo canal interno comum.

Nenhuma alteração no `LojaNovaDemanda` ou no wizard da loja.

### 5. Auditoria mínima

Quando o pedido for enviado, gravar no comentário "retorno_setor" da loja (`SolicitarAutorizacaoDialog` linhas 222-229) que o documento foi enviado junto — só para rastreabilidade interna. Não muda a UX da loja.

## Detalhes técnicos

**Arquivos tocados:**
- `src/components/financeiro/CpfApprovalDialog.tsx` — gate visual + mini-uploader inline; incluir `documento_url` no objeto `contexto` passado ao `SolicitarAutorizacaoDialog` (já existe, falta a chave).
- `src/components/financeiro/SolicitarAutorizacaoDialog.tsx` — propagar `contexto.documento_url` (já é spreadado, basta validar que está vindo) e enriquecer o texto da `mensagens_internas`.
- `src/components/mensagens/AutorizacaoExcecaoCard.tsx` — botão "Abrir documento", com `createSignedUrl` e fallback para "sem documento".

**Sem mudanças de schema.** `autorizacoes_excecao.contexto` já é `jsonb`; `metadata.documento_url` já é convenção em `solicitacoes.metadata`. RLS do bucket `cpf-documentos` já permite signed URL para autenticados.

**Sem mudanças no edge function `responder-autorizacao`** — Aprovar/Rejeitar continuam idênticos.

## Fora de escopo (rejeitado nas perguntas)

- Loja iniciando pedido de exceção.
- Terceira ação "Devolver pedindo score" no autorizador (bloqueio prévio torna desnecessária).
- Novo campo `score_url` separado do `documento_url`.