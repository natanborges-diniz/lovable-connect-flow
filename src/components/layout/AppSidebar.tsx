import { useLocation } from "react-router-dom";
import {
  LayoutDashboard, Users, FileText, MessageSquare, ListTodo, Settings,
  Search as SearchIcon, Plus, List, Clock, Kanban, DollarSign, CalendarDays
} from "lucide-react";
import { cn } from "@/lib/utils";
import { NavLink } from "@/components/NavLink";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import type { ModuleKey } from "./AppLayout";

interface AppSidebarProps {
  activeModule: ModuleKey;
}

interface MenuItem {
  title: string;
  url: string;
  icon: React.ElementType;
}

interface MenuSection {
  label: string;
  items: MenuItem[];
}

const moduleMenus: Record<ModuleKey, MenuSection[]> = {
  dashboard: [
    {
      label: "Visão Geral",
      items: [
        { title: "Dashboard", url: "/", icon: LayoutDashboard },
      ],
    },
  ],
  crm: [
    {
      label: "CRM",
      items: [
        { title: "Pipeline", url: "/crm", icon: Kanban },
        { title: "Todos os Contatos", url: "/crm/contatos", icon: Users },
      ],
    },
  ],
  financeiro: [
    {
      label: "Financeiro",
      items: [
        { title: "Pipeline Financeiro", url: "/financeiro", icon: DollarSign },
      ],
    },
  ],
  agendamentos: [
    {
      label: "Agendamentos",
      items: [
        { title: "Pipeline Agendamentos", url: "/agendamentos", icon: CalendarDays },
      ],
    },
  ],
  solicitacoes: [
    {
      label: "Solicitações",
      items: [
        { title: "Todas as Solicitações", url: "/solicitacoes", icon: FileText },
      ],
    },
  ],
  atendimentos: [
    {
      label: "Atendimentos",
      items: [
        { title: "Todos os Atendimentos", url: "/atendimentos", icon: MessageSquare },
      ],
    },
  ],
  tarefas: [
    {
      label: "Tarefas",
      items: [
        { title: "Todas as Tarefas", url: "/tarefas", icon: ListTodo },
      ],
    },
  ],
  configuracoes: [
    {
      label: "Configurações",
      items: [
        { title: "IA", url: "/configuracoes?tab=ia", icon: Settings },
        { title: "Estrutura", url: "/configuracoes?tab=estrutura", icon: Settings },
        { title: "Lojas", url: "/configuracoes?tab=lojas", icon: Settings },
        { title: "WhatsApp", url: "/configuracoes?tab=whatsapp", icon: Settings },
        { title: "Automações", url: "/configuracoes?tab=automacoes", icon: Settings },
      ],
    },
  ],
};

export function AppSidebar({ activeModule }: AppSidebarProps) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const sections = moduleMenus[activeModule] || [];

  if (sections.length === 0 || sections.every(s => s.items.length === 0)) {
    return null;
  }

  return (
    <Sidebar collapsible="icon" className="border-r">
      <SidebarContent className="pt-2">
        {sections.map((section) => (
          <SidebarGroup key={section.label}>
            {!collapsed && (
              <SidebarGroupLabel className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {section.label}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => {
                  const itemPath = item.url.split("?")[0];
                  const itemParams = new URLSearchParams(item.url.split("?")[1] || "");
                  const currentParams = new URLSearchParams(location.search);
                  const isActive = item.url.includes("?")
                    ? location.pathname === itemPath && itemParams.get("tab") === currentParams.get("tab")
                    : location.pathname === item.url;

                  return (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        tooltip={collapsed ? item.title : undefined}
                      >
                        <NavLink
                          to={item.url}
                          end
                          className={cn(
                            "flex items-center gap-3 transition-colors duration-150 relative",
                            isActive && "border-l-2 border-primary pl-[10px]"
                          )}
                          activeClassName="bg-brand-soft text-primary font-medium"
                        >
                          <item.icon className="h-4 w-4 shrink-0" />
                          {!collapsed && <span className="truncate">{item.title}</span>}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
