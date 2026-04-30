## Objetivo

Hoje a loja recebe apenas o resultado inicial da Consulta CPF (Aprovado / Reprovado / Dados Incompletos). Quando o operador escala para uma exceção via supervisor/diretor, a loja fica sem nenhuma atualização até (eventualmente) o card mover. Vamos fechar essa lacuna com 3 mensagens read-only no Messenger, mantendo o padrão atual.

## Ciclo completo de comunicação com a loja

```text
Operador analisa CPF
   |
   +-- Aprovado          -> [JÁ EXISTE] msg "✅ Aprovado"
   +-- Reprovado         -> [JÁ EXISTE] msg "❌ Reprovado: <motivo>"
   +-- Dados Incompletos -> [JÁ EXISTE] msg "⚠️ Pendente: <observação>"
                                          |
                                          v
                            Operador solicita exceção a supervisor/diretor
                                          |
                                          +-- [NOVO 1] msg "🔄 Em análise especial — aguarde"
                                                                   |
                                          Supervisor responde      v
                                                                   |
                                          +-- Aprovado  -> [NOVO 2] msg "✅ Liberado por exceção (Sup. Fulano)"
                                                          + card move p/ "Consulta CPF Aprovado"
                                          +-- Rejeitado -> [NOVO 3] msg "❌ Exceção não aprovada — resultado anterior mantido"
                                                          + card permanece em Reprovado/Dados Incompletos
```

## Mudanças técnicas

### 1. Mensagem "exceção solicitada" (NOVO)

Em `src/components/financeiro/SolicitarAutorizacaoDialog.tsx`, após criar o registro em `autorizacoes_excecao`, disparar mensagem read-only para a loja (mesmo padrão usado hoje em "Reprovado/Dados Incompletos"): inserir em `mensagens_internas` com `conversa_id = ponte_<solicitacao_id>`, `metadata.kind = "retorno_setor"`, `metadata.read_only = true`, conteúdo:

> 🔄 *Sua solicitação está em análise especial. Um supervisor foi acionado para avaliar uma possível exceção. Aguarde o retorno.*

E registrar comentário em `solicitacao_comentarios` com `tipo = "autorizacao_solicitada"` para histórico.

### 2/3. Mensagens "exceção aprovada" e "exceção rejeitada" (NOVO)

Em `supabase/functions/responder-autorizacao/index.ts`, adicionar — depois de aplicar o efeito do processo e antes do return — um bloco que envia mensagem read-only à loja quando `referencia_tipo = "solicitacao"` e `processo_chave = "consulta_cpf_excecao"`:

- Buscar `solicitacao` para obter `loja_telefone` / `solicitante_loja` do `metadata` (mesmo caminho que `pipeline-automations` usa para identificar a loja).
- Resolver o `destinatario_id` da loja (perfil com `tipo_usuario = 'loja'` vinculado ao telefone, mesmo lookup já existente para os retornos atuais).
- Inserir em `mensagens_internas`:
  - **Aprovado:** `✅ Liberação aprovada por exceção pelo supervisor *<nome>*. Sua solicitação pode prosseguir.`
  - **Rejeitado:** `❌ A exceção não foi aprovada pelo supervisor *<nome>*. O resultado anterior (<Reprovado | Dados Incompletos>) permanece válido.${justificativa ? "\nMotivo: <justificativa>" : ""}`
  - `metadata: { kind: "retorno_setor", read_only: true, autorizacao_id, decisao }`
  - `conversa_id = ponte_<solicitacao_id>`

### 4. Histórico no card

Já existe inserção em `solicitacao_comentarios` para aprovado/rejeitado. Adicionar também o comentário no momento da **solicitação** da exceção (passo 1) para fechar a trilha de auditoria.

### 5. Render no Messenger

`src/pages/Mensagens.tsx` já trata `metadata.kind === "retorno_setor"` como bolha read-only (sem caixa de resposta). As 3 novas mensagens reusam o mesmo `kind` — nenhuma mudança de UI necessária.

## Arquivos a modificar

- `src/components/financeiro/SolicitarAutorizacaoDialog.tsx` — disparar msg "em análise" + comentário no card.
- `supabase/functions/responder-autorizacao/index.ts` — disparar msg "aprovado por exceção" / "exceção rejeitada" para a loja.

## Sem mudanças de schema

Reutiliza `mensagens_internas`, `solicitacao_comentarios` e o padrão `metadata.kind = "retorno_setor"` já existente. Nenhuma migração necessária.

## Validação manual sugerida

1. Reprovar um CPF → loja vê "❌ Reprovado".
2. Operador clica "Solicitar autorização de exceção" → loja vê "🔄 Em análise especial".
3a. Supervisor aprova → loja vê "✅ Liberação aprovada por exceção" e card vai para "Consulta CPF Aprovado".
3b. Supervisor rejeita → loja vê "❌ Exceção não aprovada — resultado anterior mantido"; card fica em Reprovado.
