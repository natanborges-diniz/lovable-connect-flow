## Problema encontrado

Hoje a administração de usuários mistura **dois modelos ao mesmo tempo**:

1. **Modelo novo (fonte desejada):** `user_acessos`
   - guarda módulos, escopo, `acesso_total`
   - dispara trigger que sincroniza `profiles.tipo_usuario` e `user_roles`

2. **Modelo antigo / legado ainda ativo na UI e backend:** `profiles.tipo_usuario` + `user_roles`
   - várias consultas e labels ainda leem isso diretamente
   - a edge function `admin-create-user` ainda cria `user_roles` direto
   - a tela lista usuários por `profiles`, mas mostra “nível” por `user_roles`

Isso gera exatamente o sintoma que você descreveu: um usuário pode abrir com sinais contraditórios como “campos vazios”, “Admin” e “acesso total” ao mesmo tempo, porque cada pedaço da tela está olhando para uma fonte diferente.

## Objetivo

Fazer o admin trabalhar com **uma única fonte de verdade real** para permissões e escopo:
- `user_acessos` = verdade para permissões
- `profiles` = identidade e classificação derivada
- `user_roles` = espelho técnico para compatibilidade/RLS, não mais fonte de edição

## Plano de unificação

### 1. Definir a regra oficial do modelo
Padronizar a semântica para o admin:
- **Identidade:** `profiles` (`nome`, `email`, `cargo`)
- **Permissões e escopo:** `user_acessos`
- **Tipo exibido na UI:** derivado de `user_acessos` / `profiles.tipo_usuario`
- **`user_roles`:** apenas espelho automático, nunca editado manualmente pela tela

### 2. Refatorar a tela de Gestão de Usuários para um único fluxo
Na aba Usuários:
- manter **um único editor** para criar/editar usuário
- esse editor passa a carregar e salvar a partir de:
  - `profiles` para identidade
  - `user_acessos` para acesso total, módulos, lojas e setores
- remover da UI ativa os fluxos antigos que ainda manipulam `user_roles` ou `profiles.tipo_usuario` como se fossem fonte principal

### 3. Corrigir a listagem para mostrar estado coerente
A grade de usuários deve ser montada com dados consistentes:
- buscar `profiles`
- buscar `user_acessos`
- usar `user_roles` só se realmente necessário para compatibilidade visual, nunca para decidir o “tipo principal” do usuário

Exibição proposta:
- **Tipo**: derivado de `profiles.tipo_usuario` sincronizado pelo trigger
- **Escopo**: vindo de `user_acessos.lojas` / `user_acessos.setores`
- **Acesso total**: vindo exclusivamente de `user_acessos.acesso_total`
- badges e textos devem parar de inferir “admin” por caminhos paralelos

### 4. Revisar a criação de usuário
A edge function `admin-create-user` hoje ainda cria `user_roles` direto.

Ajuste proposto:
- ela cria o usuário e o profile base
- a configuração de permissões passa a ser feita pela gravação em `user_acessos`
- o trigger continua sincronizando `profiles.tipo_usuario` e `user_roles`

Assim o fluxo de criação fica igual ao de edição, sem bifurcação.

### 5. Corrigir a autorização do admin moderno
As RLS de escrita em gestão de usuários devem reconhecer o modelo novo:
- usuários com `acesso_total = true`, ou
- módulo `configuracoes` com poder de agir

Isso vale para as tabelas do fluxo:
- `user_acessos`
- `profiles`
- `user_roles`

Sem isso, o frontend pode estar correto e ainda assim o banco barrar com “row-level security policy”.

### 6. Simplificar o conceito para o administrador
Na UX do editor:
- parar de expor conceitos duplicados como se fossem independentes
- deixar claro que:
  - “Acesso total” controla tudo
  - módulos definem permissões finas
  - lojas/setores definem escopo
  - tipo do usuário é consequência da configuração, não uma segunda configuração paralela

Ou seja: o admin não deveria precisar pensar em “tipo + role + acesso + escopo” como quatro coisas diferentes quando na prática são duas camadas: identidade e permissão.

## Resultado esperado

Depois dessa unificação:
- ao abrir Fran Borges, a tela mostrará um estado único e coerente
- não haverá mais “Admin” por um lado e campos vazios por outro
- salvar usuário deixará de depender de duas estruturas competindo entre si
- o administrador passa a entender a lógica sem ambiguidade

## Detalhes técnicos

Arquivos mais impactados:
- `src/components/configuracoes/GestaoUsuariosCard.tsx`
- `src/components/configuracoes/AcessosEditorDialog.tsx`
- `src/hooks/useAuth.tsx`
- `supabase/functions/admin-create-user/index.ts`
- nova migration para ajustar RLS e, se necessário, funções auxiliares de permissão

Direção técnica:
```text
profiles         = identidade
user_acessos     = fonte única de permissões/escopo
user_roles       = espelho automático para compatibilidade
```

Critérios de validação:
- abrir usuário sem contradições visuais
- editar e salvar sem erro de RLS
- criar novo usuário pelo mesmo modelo
- admin e operador com Configurações autorizado funcionam
- usuário sem permissão continua bloqueado