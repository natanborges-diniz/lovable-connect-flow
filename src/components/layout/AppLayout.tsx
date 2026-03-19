import { useMemo } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { TopNavigation } from "./TopNavigation";
import { AppSidebar } from "./AppSidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

export type ModuleKey = "dashboard" | "crm" | "solicitacoes";

export const moduleFromPath = (pathname: string): ModuleKey => {
  if (pathname.startsWith("/crm")) return "crm";
  if (pathname.startsWith("/solicitacoes")) return "solicitacoes";
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
