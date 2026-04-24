## Converter Franciana em cliente para testes

### Diagnóstico
Hoje existem dois registros relevantes:

- **Franciana** (`contatos`): `tipo = loja`, vinculada ao setor "Atendimento Corporativo" e a uma coluna do pipeline interno, com telefone `5584994244323`.
- O telefone `5584994244323` está cadastrado em `telefones_lojas` como **"Loja Teste"** (`tipo = loja`, `ativo = true`).

Enquanto esse telefone permanecer em `telefones_lojas` como ativo, a função `sanitize_corporate_contact` vai **reverter** qualquer mudança: toda vez que houver insert/update na ponte ou na loja, ela força o contato de volta para `tipo = loja` e setor corporativo. Por isso as tentativas anteriores não "pegaram".

Também há um segundo contato chamado **Fran Borges** já como `cliente` (sem telefone) — vou deixá-lo intacto.

### Ações (somente dados, sem mudança de schema)

1. **Desativar o telefone corporativo** em `telefones_lojas`:
   - `UPDATE telefones_lojas SET ativo = false WHERE id = 'de4021e5-...'`
   - Necessário para o saneamento corporativo parar de reescrever o contato.

2. **Atualizar o contato Franciana** (`id 90ddecb2-...`):
   - `tipo = 'cliente'`
   - `setor_destino = NULL` (sai do setor corporativo)
   - `pipeline_coluna_id = NULL` (sai da coluna do pipeline interno; ela vai aparecer como novo lead no funil de vendas padrão do CRM)
   - `estagio = 'lead'` (mantém)

3. **Desativar ponte corporativa** existente, se houver:
   - `UPDATE contato_ponte SET ativo = false WHERE contato_id = '90ddecb2-...'`

4. **Registrar evento de auditoria** em `eventos_crm` explicando a reclassificação manual para testes.

### Validação
- Página **Contatos**: Franciana aparece com badge "Cliente".
- Página **CRM**: Franciana aparece como lead novo (sem coluna fixa do setor corporativo).

### Observação importante
Como o telefone `5584994244323` é cadastrado como "Loja Teste", se você voltar a ativá-lo em `telefones_lojas` no futuro, o trigger `on_telefone_loja_change` rodará o saneamento e **vai reverter** Franciana para `tipo = loja` novamente. Para os testes como cliente, ele precisa ficar inativo. Confirme que tudo bem desativar "Loja Teste".
