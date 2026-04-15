

# Limpar Menu de Configurações: Sidebar como Navegação Única

## Problema

A página de Configurações tem **duas navegações redundantes**: a sidebar lateral (5 itens) e uma barra de tabs horizontal dentro da página (7 itens). Isso torna o menu extenso e confuso.

## Solução

Remover a barra de tabs horizontal da página e usar **apenas a sidebar** para navegação. Adicionar os 2 itens faltantes (Usuários e Crons) na sidebar.

## Mudanças

### 1. Sidebar — adicionar itens faltantes (`AppSidebar.tsx`)

Adicionar "Usuários" e "Crons" ao menu do módulo `configuracoes`:

```
IA
Estrutura
Usuários      ← novo
Lojas
WhatsApp
Automações
Crons         ← novo
```

### 2. Página — remover TabsList (`Configuracoes.tsx`)

- Remover o componente `<TabsList>` com os 7 `<TabsTrigger>`
- Manter os `<TabsContent>` controlados pelo `?tab=` da URL (já funciona via sidebar)
- O resultado: página limpa mostrando apenas o conteúdo da seção selecionada

## Arquivos Modificados

| Arquivo | Mudança |
|---------|---------|
| `src/components/layout/AppSidebar.tsx` | Adicionar Usuários e Crons ao menu `configuracoes` |
| `src/pages/Configuracoes.tsx` | Remover `TabsList` / `TabsTrigger`, manter apenas `TabsContent` |

