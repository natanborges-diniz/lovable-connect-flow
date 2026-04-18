
O usuário quer um cadastro simples de telefones que, ao chegarem, são direcionados automaticamente para um setor — exatamente como já acontece com a Diniz E-commerce hoje via "ponte de mensageria".

Vou revisar o que já existe e propor o caminho mais limpo.

## O que já existe (e funciona)

1. **Tabela `telefones_lojas`** — já cadastra telefones corporativos (loja/colaborador/departamento) com `tipo`, `nome`, etc. Tem trigger `on_telefone_loja_change` que dispara `sanitize_corporate_contact` automaticamente.

2. **Função `sanitize_corporate_contact`** — quando um telefone é cadastrado:
   - força `setor_destino = Atendimento Corporativo` no contato
   - ajusta `tipo` (loja/colaborador)
   - encerra atendimentos humanos órfãos
   - limpa coluna de pipeline não-corporativa

3. **Sistema de Ponte (`contato_ponte`)** — quando contato tem `setor_destino` e o setor tem **um único** responsável ativo, ativa modo "ponte": mensagens do WhatsApp espelham na mensageria interna do responsável e respostas dele voltam pelo WhatsApp. Trigger `on_contato_setor_destino_change` faz isso automaticamente.

4. **UI já existe**: `TelefonesLojasCard` em Configurações faz CRUD completo.

## O gap

O fluxo atual **força tudo para "Atendimento Corporativo"**. O caso Diniz funciona porque:
- foi cadastrado como tipo `loja` em `telefones_lojas`
- alguém manualmente trocou o `setor_destino` do contato para "Dpto Armações"
- como Marilene é a única no setor, a ponte ativou

Para o usuário poder cadastrar novos telefones e escolher o setor de destino direto no cadastro (sem ajuste manual), falta:

1. **Permitir escolher o setor de destino no cadastro** do telefone (hoje só pode escolher tipo loja/colaborador/departamento, mas não para qual setor mandar).
2. **Ajustar `sanitize_corporate_contact`** para respeitar um `setor_destino_id` configurado no `telefones_lojas` em vez de sempre forçar "Atendimento Corporativo".

## Plano

### 1. Adicionar coluna `setor_destino_id` em `telefones_lojas`
Migration adicionando a coluna (nullable, FK lógica para `setores.id`). Quando preenchida, sobrescreve o setor padrão corporativo.

### 2. Atualizar `sanitize_corporate_contact`
Migration alterando a função: se o registro de `telefones_lojas` tiver `setor_destino_id` preenchido, usa ele; senão cai no "Atendimento Corporativo" como hoje.

### 3. Atualizar `TelefonesLojasCard.tsx`
Adicionar um `<Select>` "Setor de Destino" no formulário (lista vinda da tabela `setores` ativos). Mostrar a coluna "Setor" na tabela.

### 4. Validar fluxo end-to-end
Testar com um telefone novo: cadastrar → escolher setor → mandar WhatsApp do número → confirmar que cai como mensagem interna no responsável único do setor.

## Arquivos a editar

- **Nova migration**: adicionar coluna + atualizar função `sanitize_corporate_contact`
- `src/components/configuracoes/TelefonesLojasCard.tsx`: campo "Setor de Destino" + coluna na tabela
- `.lovable/memory/arquitetura/ponte-mensageria-whatsapp.md`: registrar que `setor_destino_id` em `telefones_lojas` agora dirige a ponte

## Resultado esperado

Usuário entra em Configurações → Telefones Corporativos → Novo Cadastro:
- digita telefone
- escolhe tipo (loja/colaborador/departamento)
- **escolhe setor de destino** (Dpto Armações, Financeiro, TI, etc.)
- salva

Quando esse número mandar WhatsApp:
- contato é criado/atualizado
- `setor_destino` vai pro setor escolhido
- se o setor tem 1 responsável → ponte ativa, msg cai no chat interno dele
- se tem 0 ou >1 → fluxo normal de IA/humano

## Detalhes técnicos

- A ponte só ativa com responsável único — isso é regra existente, não muda. Se o usuário cadastrar setor com vários atendentes, a msg cai no atendimento normal do setor (não vira ponte 1:1).
- O reaproveitamento de contato por telefone já existe (`idx_contatos_telefone_unique`), então re-cadastrar não duplica.
- A trigger `on_telefone_loja_change` já dispara `sanitize_corporate_contact` em INSERT/UPDATE, então mudar o setor no cadastro reflete imediatamente nos contatos existentes daquele telefone.
