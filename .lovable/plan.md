

# Unificar Cadastro de Telefones: Lojas, Colaboradores e Departamentos

## Situação Atual

- A tabela `telefones_lojas` só suporta tipo "loja"
- O webhook identifica telefones nessa tabela e direciona ao bot com `tipo_bot = "loja"`
- Fluxos de colaborador (ex: Compra de Funcionário) foram criados no banco mas não há como um colaborador acessá-los porque seu telefone não é reconhecido

## O que muda

### 1. Expandir a tabela `telefones_lojas` (migration)

Adicionar colunas:
- `tipo` (text, default `'loja'`) — valores: `loja`, `colaborador`, `departamento`
- `cargo` (text, nullable) — cargo do colaborador (ex: "Gerente", "Vendedor"). Usado para controle de permissão futura
- `nome_colaborador` (text, nullable) — nome da pessoa (para colaboradores)

A tabela mantém o nome `telefones_lojas` para não quebrar queries existentes, mas passa a ser o cadastro unificado de todos os telefones corporativos.

### 2. Atualizar UI — `TelefonesLojasCard.tsx`

- Renomear visualmente para "Telefones Corporativos"
- Adicionar campo **Tipo** (select: Loja / Colaborador / Departamento) no formulário
- Quando tipo = `colaborador`: mostrar campos **Nome do Colaborador** e **Cargo**
- Quando tipo = `departamento`: mostrar campo **Nome do Departamento** (usa `nome_loja`)
- Quando tipo = `loja`: formulário atual (endereço, horário, Google Maps, cod_empresa)
- Adicionar filtro por tipo na listagem (tabs ou select)
- Coluna "Tipo" na tabela com badge colorido

### 3. Atualizar webhook — `whatsapp-webhook/index.ts`

- Na consulta à `telefones_lojas`, já traz o campo `tipo`
- Passa `tipo_bot` para o `bot-lojas` baseado no `tipo` do registro:
  - `loja` → `tipo_bot: "loja"`
  - `colaborador` → `tipo_bot: "colaborador"`
  - `departamento` → `tipo_bot: "departamento"` (ou mapeia para o tipo adequado)
- Atualiza `contato.tipo` conforme o tipo do telefone (loja, colaborador, etc.)

### 4. Atualizar `bot-lojas/index.ts`

- Já recebe `tipo_bot` via `loja_info` — nenhuma mudança no motor
- O menu já filtra por `tipo_bot` — basta que os registros em `bot_menu_opcoes` usem o tipo correto

## Arquivos afetados

| Arquivo | Mudança |
|---------|---------|
| Migration SQL | Adicionar colunas `tipo`, `cargo`, `nome_colaborador` em `telefones_lojas` |
| `src/components/configuracoes/TelefonesLojasCard.tsx` | Formulário condicional por tipo, filtro na listagem |
| `supabase/functions/whatsapp-webhook/index.ts` | Passar `tipo_bot` baseado no `tipo` do registro |

## Resultado

- Cadastro único para lojas, colaboradores e departamentos
- Um gerente cadastrado como "colaborador" com cargo "Gerente" pode solicitar Compra de Funcionário
- Uma loja pode solicitar os mesmos fluxos do menu de loja
- O menu do bot se adapta automaticamente ao tipo do telefone

