

# Visibilidade do Ciclo de Funil

## Situação Atual

- O `ciclo_funil` existe no banco mas só é usado como filtro no Dashboard (gráfico de funil)
- Nos cards do pipeline CRM não há nenhuma indicação visual do ciclo
- Não há detalhes do ciclo na ficha/detalhe do contato

## O que falta

### 1. Badge de ciclo nos cards do Pipeline CRM
Adicionar um badge discreto nos cards de contato que estejam em ciclo 2+. Exemplo: badge "Retorno" ou "Ciclo 3" para distinguir visualmente leads reativados de leads novos.

Cards de ciclo 1 (novo) não mostram nada extra — é o comportamento padrão.

### 2. Filtro de ciclo no Pipeline CRM
Assim como o Dashboard tem filtro "Todos / Novos / Retornos", o pipeline CRM também pode ter esse filtro para que o operador veja apenas novos leads ou apenas retornos.

### 3. Ciclos 3, 4, 5...
A lógica já suporta ciclos infinitos (cada retorno incrementa +1). No Dashboard, o filtro "Retornos (Ciclo 2+)" agrupa todos. Opcionalmente podemos mostrar no gráfico a distribuição por ciclo individual (2, 3, 4...) para entender quantas vezes leads precisam ser reativados.

## Arquivos afetados

| Arquivo | Mudança |
|---------|---------|
| `src/pages/Pipeline.tsx` (ou componente de card) | Badge "Retorno" / "Ciclo N" nos cards com ciclo >= 2 |
| `src/pages/Pipeline.tsx` | Filtro de ciclo (Todos / Novos / Retornos) no topo do pipeline |
| `src/pages/Dashboard.tsx` | Opcional: breakdown por ciclo individual no tooltip do funil |

## Resultado

- Operador vê imediatamente quais cards são retornos no Kanban
- Pode filtrar o pipeline para focar em novos leads ou em reativações
- Ciclos 3+ continuam funcionando automaticamente — o badge mostra "Ciclo 3", "Ciclo 4", etc.

