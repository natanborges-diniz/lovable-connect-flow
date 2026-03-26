

## Plano: Melhorar Acesso a Conversas/Atendimentos

### Problema

A página `/atendimentos` existe na navegação, mas:
1. A busca só filtra por `atendente_nome` — não busca por nome do contato ou assunto
2. Não há link direto do card no CRM para o atendimento ativo
3. O operador precisa navegar pelo CRM, clicar no card, e abrir por lá — caminho indireto

### Solução

**1. Busca expandida na página Atendimentos**

Alterar o filtro de busca para pesquisar também por **nome do contato** e **assunto da solicitação**, não apenas por atendente. Isso permite encontrar qualquer conversa rapidamente.

- No `useAtendimentos`, trocar o `.ilike("atendente_nome", ...)` por um filtro `.or()` que busque em `contato.nome`, `solicitacao.assunto` e `atendente_nome`
- Atualizar o placeholder do input para "Buscar por contato, assunto ou atendente..."

**2. Link direto do card do Pipeline para o atendimento**

No card do CRM (Pipeline), adicionar um botão/ícone de "abrir conversa" que navega direto para `/atendimentos` e abre o dialog do atendimento ativo daquele contato.

- Verificar o componente de card do Pipeline e adicionar ícone `MessageSquare` clicável
- Ao clicar, navegar para `/atendimentos?open={atendimento_id}`
- Na página Atendimentos, ler o query param `open` e abrir o dialog automaticamente

**3. Filtro por contato via query param**

Permitir que links externos (ou do CRM) abram a página já filtrada:
- `/atendimentos?contato=João` → preenche a busca
- `/atendimentos?open=uuid` → abre o dialog direto

### Arquivos alterados

1. **`src/hooks/useAtendimentos.ts`** — expandir filtro de busca com `.or()` para contato/assunto/atendente
2. **`src/pages/Atendimentos.tsx`** — ler query params (`open`, `contato`), abrir dialog automaticamente, atualizar placeholder
3. **`src/pages/Pipeline.tsx`** (ou componente de card) — adicionar botão de acesso rápido ao atendimento

### Resultado

O operador poderá:
- Ir em "Atendimentos" na nav superior e buscar por nome do contato (ex: "João")
- Clicar num ícone de conversa no card do CRM e cair direto no chat
- Usar a URL `/atendimentos?open=ID` como atalho

