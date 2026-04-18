
A sidebar já é colapsável (botão no footer recolhe para modo ícone, ~3rem). O usuário quer:
1. Reduzir a largura quando expandida (hoje shadcn default é `--sidebar-width: 16rem`).
2. Confirmar que pode recolher totalmente (já existe via toggle).

**Plano:**

**Arquivo:** `src/components/layout/AppLayout.tsx`

Passar `style` ao `SidebarProvider` reduzindo a largura expandida de 16rem para ~12rem:

```tsx
<SidebarProvider style={{ "--sidebar-width": "12rem" } as React.CSSProperties}>
```

Isso libera ~4rem de largura para o Pipeline quando a sidebar está aberta. O modo colapsado (ícones) já funciona via botão "Recolher" no footer da `AppSidebar`.

Sem outras mudanças — o toggle existente já permite minimizar para a esquerda mostrando só ícones.
