import { useNavigate } from "react-router-dom";
import { LayoutDashboard, Users, FileText, MessageSquare, ListTodo, Settings, LogOut, DollarSign, CalendarDays, Store } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import type { ModuleKey } from "./AppLayout";

interface TopNavigationProps {
  activeModule: ModuleKey;
}

const modules: { key: ModuleKey; label: string; icon: React.ElementType; defaultPath: string }[] = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard, defaultPath: "/" },
  { key: "crm", label: "CRM", icon: Users, defaultPath: "/crm" },
  { key: "financeiro", label: "Financeiro", icon: DollarSign, defaultPath: "/financeiro" },
  { key: "agendamentos", label: "Agendamentos", icon: CalendarDays, defaultPath: "/agendamentos" },
  { key: "atendimento_gael", label: "Lojas", icon: Store, defaultPath: "/atendimento-gael" },
  { key: "solicitacoes", label: "Solicitações", icon: FileText, defaultPath: "/solicitacoes" },
  { key: "atendimentos", label: "Atendimentos", icon: MessageSquare, defaultPath: "/atendimentos" },
  { key: "tarefas", label: "Tarefas", icon: ListTodo, defaultPath: "/tarefas" },
  { key: "configuracoes", label: "Config", icon: Settings, defaultPath: "/configuracoes" },
];

export function TopNavigation({ activeModule }: TopNavigationProps) {
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();

  return (
    <header className="sticky top-0 z-50 w-full bg-surface border-b-2 border-primary">
      <div className="flex h-14 items-center px-4 gap-4">
        {/* Logo */}
        <div className="flex items-center gap-2 mr-4">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2 rounded-lg p-1 hover:bg-muted transition-colors duration-150"
            aria-label="Ir para o início"
          >
            <span className="text-sm font-bold tracking-wide text-primary">
              INFOCO <span className="text-muted-foreground font-semibold">OPS</span>
            </span>
          </button>
        </div>

        {/* Module Tabs */}
        <nav className="flex items-center gap-1 overflow-x-auto" role="tablist" aria-label="Módulos do sistema">
          {modules.map((module) => {
            const Icon = module.icon;
            const isActive = activeModule === module.key;

            return (
              <button
                key={module.key}
                role="tab"
                aria-selected={isActive}
                onClick={() => navigate(module.defaultPath)}
                className={cn(
                  "relative flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors duration-150 whitespace-nowrap",
                  "hover:bg-muted hover:text-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  isActive ? "text-primary" : "text-muted-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden md:inline">{module.label}</span>
                {isActive && (
                  <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-primary rounded-full" />
                )}
              </button>
            );
          })}
        </nav>

        {/* Spacer */}
        <div className="flex-1" />

        {/* User area */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground hidden sm:inline">
            {profile?.nome || "Operador"}
          </span>
          <Button variant="ghost" size="icon" onClick={signOut} className="h-8 w-8" title="Sair">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}
