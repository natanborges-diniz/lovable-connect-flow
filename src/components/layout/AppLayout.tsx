import { useMemo } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { TopNavigation } from "./TopNavigation";
import { AppSidebar } from "./AppSidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

export type ModuleKey = "dashboard" | "crm" | "financeiro" | "agendamentos" | "atendimento_gael" | "solicitacoes" | "atendimentos" | "tarefas" | "configuracoes";

export const moduleFromPath = (pathname: string): ModuleKey => {
  if (pathname.startsWith("/atendimento-gael")) return "atendimento_gael";
  if (pathname.startsWith("/agendamentos")) return "agendamentos";
  if (pathname.startsWith("/financeiro")) return "financeiro";
  if (pathname.startsWith("/crm")) return "crm";
  if (pathname.startsWith("/solicitacoes")) return "solicitacoes";
  if (pathname.startsWith("/atendimentos")) return "atendimentos";
  if (pathname.startsWith("/tarefas")) return "tarefas";
  if (pathname.startsWith("/configuracoes")) return "configuracoes";
  return "dashboard";
};

export function AppLayout() {
  const location = useLocation();
  const activeModule = useMemo(() => moduleFromPath(location.pathname), [location.pathname]);

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
