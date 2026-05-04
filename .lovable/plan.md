## Diagnóstico

O número **5511963268878** continua não sendo atendido mesmo após você ter desativado o cadastro em Telefones Corporativos. Investiguei e achei 3 resíduos do estado anterior que travam o fluxo:

1. **`telefones_lojas`**: `ativo=false` ✅ (correto, foi o que você fez)
2. **`contatos`**: ainda está com `tipo='loja'` e `setor_destino='Atendimento Corporativo'` (resíduo do saneamento corporativo anterior)
3. **`atendimentos`** (b91af612...): `modo='ponte'`, `status='aguardando'` — herdado da época em que tinha responsável único
4. **`contato_ponte`**: `ativo=false` (ok), mas o atendimento ainda está marcado `modo=ponte`

**Causa raiz:** o webhook, ao ver atendimento aberto com `modo='ponte'`, desvia para `bridge-mensageria` em vez de `ai-triage`. Como a ponte está inativa, a mensagem fica "no limbo" — nem IA responde, nem espelha pro Messenger interno.

**Falha de design:** o trigger `on_telefone_loja_change` só roda `sanitize_corporate_contact` quando o telefone é **ativado/criado**. Quando você **desativa**, nenhum saneamento reverso acontece — o contato fica preso no estado corporativo.

## Plano

### 1. Saneamento imediato do contato 8878 (migração one-shot)
- `contatos`: setar `tipo='cliente'`, `setor_destino=NULL`, `pipeline_coluna_id=NULL`
- `atendimentos` abertos do contato: `modo='ia'` (assim ai-triage volta a processar)
- `contato_ponte`: garantir `ativo=false` (já está)

### 2. Corrigir o trigger (causa raiz)
Estender `on_telefone_loja_change` para tratar **desativação** (`ativo true→false`) ou **deleção** do cadastro:
- Reverter contatos com aquele telefone para `tipo='cliente'`, `setor_destino=NULL`
- Limpar `pipeline_coluna_id` se a coluna pertencia ao setor corporativo
- Mudar atendimentos abertos `modo='ponte'` ou `modo='humano' sem atendente` para `modo='ia'`
- Desativar `contato_ponte` correspondente
- Registrar evento `desclassificacao_corporativa` em `eventos_crm`

Implementação: nova função `desanitize_corporate_contact(_telefone)` simétrica à atual, chamada pelo trigger no caminho de desativação.

### 3. Validação
- Reenviar mensagem do 8878 e confirmar nos logs do `ai-triage` que ele entra normalmente
- Verificar que próximo telefone que você desativar recebe o saneamento reverso automaticamente

## Detalhes técnicos

Arquivos afetados:
- Migração SQL: nova função `desanitize_corporate_contact` + atualização do trigger `on_telefone_loja_change`
- Migração SQL one-shot para corrigir o estado atual do contato `62e4499c-...` e o atendimento `b91af612-...`

Sem mudanças em edge functions ou frontend.
