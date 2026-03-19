

## Plano: Adotar o Design System INFOCO e criar identidade "INFOCO OPS"

### Nome do App

**INFOCO OPS** — Plataforma de Comunicação e Operações, parte da família [Infoco Optical Business](/projects/e140a688-5bbc-4d93-93ab-3e3a1e60171e).

Naming pattern da família:
- **INFOCO** (marca-mãe) — Gestão Operacional / BI
- **INFOCO OPS** (este app) — Comunicação, Atendimento e Tarefas

---

### O que será feito

**1. Design System — Migrar para os tokens INFOCO**

Substituir completamente o `index.css` e `tailwind.config.ts` para adotar o design system do INFOCO Optical Business:
- Tokens de brand (HSL 220 70% 50%), neutral scale (50-900), semantic colors (success, warning, danger, info) com variantes soft/muted/hover
- Tokens de superfície: `app-bg`, `surface`, `surface-alt`, `header-accent`
- Focus ring, DataViz palette (8 chart colors)
- Dark mode completo
- Utilitários `shadow-card` e `shadow-card-hover`
- Border radius `0.75rem`

**2. Layout — Migrar para o padrão TopNavigation + Sidebar contextual**

Adotar a mesma arquitetura de layout do INFOCO:
- **TopNavigation** fixa no topo com logo "INFOCO OPS", tabs de módulos (Dashboard, CRM, Solicitações, Tarefas, Configurações) e área de usuário
- **AppSidebar** contextual usando o componente `SidebarProvider` do shadcn, com menus que mudam conforme o módulo ativo
- **AppLayout** com `<Outlet />` para rotas aninhadas
- Remover o sidebar fixo lateral atual

**3. Branding**

- Atualizar `index.html` com titulo "INFOCO OPS | Plataforma de Comunicação e Operações"
- Manter a mesma paleta de cores do INFOCO (brand blue 220)

**4. Páginas — Adaptar ao novo layout**

- Dashboard, Contatos e Solicitações passam a usar o novo `AppLayout` com `<Outlet />`
- Rotas reorganizadas: `/` (Dashboard), `/crm` (Contatos), `/solicitacoes`

---

### Detalhes Técnicos

| Arquivo | Ação |
|---|---|
| `src/index.css` | Substituir integralmente pelos tokens INFOCO (brand, neutral, semantic, surface, dataviz, dark mode) |
| `tailwind.config.ts` | Substituir integralmente pela config INFOCO (brand, neutral, success/warning/danger/info com variantes, chart, shadow, ring, transitions) |
| `src/components/layout/TopNavigation.tsx` | Criar — header fixo com logo, tabs de módulos, área de usuário |
| `src/components/layout/AppSidebar.tsx` | Reescrever — usar SidebarProvider do shadcn, menus contextuais por módulo |
| `src/components/layout/AppLayout.tsx` | Reescrever — SidebarProvider + TopNavigation + Sidebar + Outlet |
| `src/App.tsx` | Reorganizar rotas com layout aninhado |
| `index.html` | Atualizar titulo e meta tags para INFOCO OPS |
| `src/pages/Dashboard.tsx` | Remover `<AppLayout>` wrapper (agora via route) |
| `src/pages/Contatos.tsx` | Remover `<AppLayout>` wrapper, rota muda para `/crm` |
| `src/pages/Solicitacoes.tsx` | Remover `<AppLayout>` wrapper |
| `src/components/shared/StatusBadge.tsx` | Atualizar cores para usar tokens semantic (danger, warning, success, info) |

