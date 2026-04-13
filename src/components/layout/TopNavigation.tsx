import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { LayoutDashboard, Users, FileText, MessageSquare, ListTodo, Settings, LogOut, DollarSign, CalendarDays, Bell, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useNotificacoes } from "@/hooks/useNotificacoes";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ModuleKey } from "./AppLayout";

interface TopNavigationProps {
  activeModule: ModuleKey;
}

const allModules: { key: ModuleKey; label: string; icon: React.ElementType; defaultPath: string }[] = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard, defaultPath: "/" },
  { key: "crm", label: "CRM", icon: Users, defaultPath: "/crm" },
  { key: "financeiro", label: "Financeiro", icon: DollarSign, defaultPath: "/financeiro" },
  { key: "agendamentos", label: "Agendamentos", icon: CalendarDays, defaultPath: "/agendamentos" },
  { key: "solicitacoes", label: "Solicitações", icon: FileText, defaultPath: "/solicitacoes" },
  { key: "atendimentos", label: "Atendimentos", icon: MessageSquare, defaultPath: "/atendimentos" },
  { key: "tarefas", label: "Tarefas", icon: ListTodo, defaultPath: "/tarefas" },
  { key: "mensagens", label: "Mensagens", icon: Mail, defaultPath: "/mensagens" },
  { key: "configuracoes", label: "Config", icon: Settings, defaultPath: "/configuracoes" },
];

// Map setor names to allowed modules
const SETOR_MODULE_MAP: Record<string, ModuleKey[]> = {
  financeiro: ["dashboard", "financeiro", "solicitacoes", "tarefas", "mensagens"],
  ti: ["dashboard", "solicitacoes", "tarefas", "mensagens"],
  atendimento: ["dashboard", "atendimentos", "solicitacoes", "tarefas", "mensagens"],
  loja: ["dashboard", "agendamentos", "mensagens"],
};

function useSetorNames(setorIds: string[]) {
  return useQuery({
    queryKey: ["setor-names", setorIds],
    enabled: setorIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("setores")
        .select("id, nome")
        .in("id", setorIds);
      return data || [];
    },
  });
}

export function TopNavigation({ activeModule }: TopNavigationProps) {
  const navigate = useNavigate();
  const { profile, signOut, isAdmin, isOperador, getUserSetorIds, roles } = useAuth();
  const { data: notificacoes, naoLidas, marcarLida, marcarTodasLidas } = useNotificacoes();
  const [popoverOpen, setPopoverOpen] = useState(false);

  const setorIds = getUserSetorIds();
  const { data: setorNames } = useSetorNames(setorIds);

  // Filter modules based on role
  const visibleModules = (() => {
    // No roles yet (loading or new user) — show all
    if (roles.length === 0) return allModules;
    // Admin/operador see everything
    if (isAdmin || isOperador) return allModules;

    // setor_usuario: filter by setor name
    const allowedKeys = new Set<ModuleKey>(["dashboard", "solicitacoes", "tarefas"]);
    if (setorNames) {
      for (const s of setorNames) {
        const key = s.nome.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const mapped = SETOR_MODULE_MAP[key];
        if (mapped) mapped.forEach((m) => allowedKeys.add(m));
      }
    }
    return allModules.filter((m) => allowedKeys.has(m.key));
  })();

  // Notification sound
  useEffect(() => {
    if (naoLidas > 0) {
      try {
        const audio = new Audio("data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbsGczHjlkn9jl0YU2EBpGdaXU6b1ZIxEiR3Wr2ue6WCMRIkd1q9rnu1gjESJHdava57tYIxA=");
        audio.volume = 0.3;
        audio.play().catch(() => {});
      } catch {}
    }
  }, [naoLidas]);

  const handleNotifClick = (notif: any) => {
    if (!notif.lida) marcarLida.mutate(notif.id);
    if (notif.referencia_id && notif.tipo === "solicitacao") {
      navigate("/solicitacoes");
    }
    setPopoverOpen(false);
  };

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
          {visibleModules.map((module) => {
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

        {/* Notifications */}
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 relative" title="Notificações">
              <Bell className="h-4 w-4" />
              {naoLidas > 0 && (
                <Badge className="absolute -top-1 -right-1 h-4 min-w-[16px] px-1 text-[10px] flex items-center justify-center">
                  {naoLidas > 99 ? "99+" : naoLidas}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-0" align="end">
            <div className="flex items-center justify-between px-4 py-2 border-b">
              <span className="text-sm font-semibold">Notificações</span>
              {naoLidas > 0 && (
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => marcarTodasLidas.mutate()}>
                  Marcar todas como lidas
                </Button>
              )}
            </div>
            <ScrollArea className="max-h-80">
              {!notificacoes?.length ? (
                <p className="text-sm text-muted-foreground text-center py-6">Nenhuma notificação</p>
              ) : (
                notificacoes.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => handleNotifClick(n)}
                    className={cn(
                      "w-full text-left px-4 py-3 border-b last:border-0 hover:bg-muted/50 transition-colors",
                      !n.lida && "bg-primary/5"
                    )}
                  >
                    <div className="flex items-start gap-2">
                      {!n.lida && <span className="mt-1.5 h-2 w-2 rounded-full bg-primary flex-shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{n.titulo}</p>
                        {n.mensagem && <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{n.mensagem}</p>}
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {format(new Date(n.created_at), "dd/MM HH:mm", { locale: ptBR })}
                        </p>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </ScrollArea>
          </PopoverContent>
        </Popover>

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
