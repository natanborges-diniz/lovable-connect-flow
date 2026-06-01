Remover o botão duplicado de óculos no composer da página Conversas (`src/pages/Atendimentos.tsx`, linhas 703-715), mantendo apenas o botão **"Buscar produto"** já existente no header do atendimento (linha ~356).

### Mudança
- `src/pages/Atendimentos.tsx`: deletar o `<Button>` com ícone `Glasses` ao lado do anexar (linhas 703-715).
- Remover import `Glasses` se não houver mais uso no arquivo.

### Fora de escopo
- Botão do header (linha 356) — permanece.
- Pipeline.tsx (CRM Kanban) — sem alteração nesta mudança.
- Lógica do Sheet / edge function.