import { useMemo } from "react";
import { Outlet, useLocation, Navigate } from "react-router-dom";
import { TopNavigation } from "./TopNavigation";
import { AppSidebar } from "./AppSidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/useAuth";

export type ModuleKey = "dashboard" | "crm" | "financeiro" | "agendamentos" | "solicitacoes" | "atendimentos" | "tarefas" | "mensagens" | "configuracoes";

export const moduleFromPath = (pathname: string): ModuleKey => {
  if (pathname.startsWith("/agendamentos")) return "agendamentos";
  if (pathname.startsWith("/financeiro")) return "financeiro";
  if (pathname.startsWith("/crm")) return "crm";
  if (pathname.startsWith("/solicitacoes")) return "solicitacoes";
  if (pathname.startsWith("/atendimentos")) return "atendimentos";
  if (pathname.startsWith("/tarefas")) return "tarefas";
  if (pathname.startsWith("/mensagens")) return "mensagens";
  if (pathname.startsWith("/configuracoes")) return "configuracoes";
  return "dashboard";
};

export function AppLayout() {
  const location = useLocation();
  const activeModule = useMemo(() => moduleFromPath(location.pathname), [location.pathname]);
  const { isAdmin, isOperador, roles } = useAuth();

  // Redirect configuracoes to / if not admin
  if (location.pathname.startsWith("/configuracoes") && !isAdmin && roles.length > 0) {
    return <Navigate to="/" replace />;
  }

  return (
    <SidebarProvider>
      <div className="min-h-screen flex flex-col w-full bg-app-bg">
        <TopNavigation activeModule={activeModule} />
        <div className="flex flex-1 w-full">
          <AppSidebar activeModule={activeModule} />
          <main className="flex-1 overflow-auto">
            <div className="p-4 md:p-6">
              <div className="md:hidden mb-4">
                <SidebarTrigger />
              </div>
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
