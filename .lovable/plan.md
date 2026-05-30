Renomear o botão "Buscar lentes" para "Buscar produto" em todos os lugares onde aparece na interface (header do atendimento no CRM e em Atendimentos, e título/labels do Sheet se fizer sentido manter consistência).

Escopo:
- `src/pages/Atendimentos.tsx` — texto do botão no header.
- `src/pages/Pipeline.tsx` — texto do botão no header do chat do CRM.
- `src/components/atendimentos/BuscarLentesSheet.tsx` — apenas o título visível ("Buscar lentes" → "Buscar produto"), mantendo nome do arquivo/componente e lógica intactos.

Fora de escopo: renomear arquivo/componente, edge function, tabelas, abas internas (Óculos / LC / Catálogo) e qualquer comportamento.