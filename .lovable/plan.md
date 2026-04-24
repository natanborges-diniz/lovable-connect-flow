## Adicionar Fran Borges como cliente no CRM

### Diagnóstico
- Fran Borges existe em `profiles` (usuária do sistema), mas **não existe** em `contatos` (CRM).
- Para ela aparecer na lista de Contatos / Pipeline CRM como cliente, é preciso inserir um registro novo em `public.contatos`.

### Ação
Inserir um registro em `contatos` com:
- `nome`: "Fran Borges"
- `tipo`: `cliente`
- `estagio`: `lead` (padrão de entrada no funil)
- `ativo`: `true`
- `email` / `telefone` / `documento`: vazios por enquanto (posso preencher depois se você passar os dados)

### Validação
- Abrir **Contatos** no menu → ela aparece com badge "Cliente".
- Abrir **CRM** → ela aparece como novo lead na coluna inicial do pipeline.

### Observações
- Se você já tem **e-mail, telefone ou CPF/CNPJ** dela, me passe que eu já cadastro junto na inserção. Caso contrário, crio com os campos em branco e você edita depois pelo botão de editar contato.
- Não há mudança de schema nem de código — somente inserção de dado.

### Arquivos afetados
- Nenhum. Apenas operação de dado (INSERT em `contatos`).
