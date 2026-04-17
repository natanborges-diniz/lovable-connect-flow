import { useMemo } from "react";
import { Outlet, useLocation, Navigate } from "react-router-dom";
import { TopNavigation } from "./TopNavigation";
import { AppSidebar } from "./AppSidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/useAuth";

export type ModuleKey = "dashboard" | "crm" | "financeiro" | "lojas" | "ti" | "interno" | "tarefas" | "mensagens" | "configuracoes";

export const moduleFromPath = (pathname: string): ModuleKey => {
  if (pathname.startsWith("/lojas")) return "lojas";
  if (pathname.startsWith("/financeiro")) return "financeiro";
  if (pathname.startsWith("/crm")) return "crm";
  if (pathname.startsWith("/ti")) return "ti";
  if (pathname.startsWith("/interno")) return "interno";
  if (pathname.startsWith("/tarefas")) return "tarefas";
  if (pathname.startsWith("/mensagens")) return "mensagens";
  if (pathname.startsWith("/configuracoes")) return "configuracoes";
  return "dashboard";
};

export function AppLayout() {
  const location = useLocation();
  const activeModule = useMemo(() => moduleFromPath(location.pathname), [location.pathname]);
  const { isAdmin, isOperador, roles, profile, loading } = useAuth();

  // Setor "efetivo": user_roles OU profile.setor_id (fallback p/ SSO/cross-login).
  const hasEffectiveSetor =
    roles.some((r) => r.setor_id) || Boolean(profile?.setor_id);
  const isSetorOnly = !loading && !isAdmin && !isOperador && hasEffectiveSetor;
  const isAllowedSetorRoute = ["/interno", "/mensagens", "/tarefas"].some(
    (path) => location.pathname === path || location.pathname.startsWith(`${path}/`)
  );

  if (isSetorOnly && !isAllowedSetorRoute) {
    return <Navigate to="/interno" replace />;
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
