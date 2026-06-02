import { useMemo } from "react";
import { Outlet, useLocation, Navigate } from "react-router-dom";
import { TopNavigation } from "./TopNavigation";
import { AppSidebar } from "./AppSidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/useAuth";
import { useAtendimentoNotifier } from "@/hooks/useAtendimentoNotifier";

export type ModuleKey = "dashboard" | "crm" | "financeiro" | "lojas" | "ti" | "interno" | "estoque" | "tarefas" | "mensagens" | "configuracoes";

export const moduleFromPath = (pathname: string): ModuleKey => {
  if (pathname.startsWith("/lojas")) return "lojas";
  if (pathname.startsWith("/financeiro")) return "financeiro";
  if (pathname.startsWith("/crm")) return "crm";
  if (pathname.startsWith("/ti")) return "ti";
  if (pathname.startsWith("/interno")) return "interno";
  if (pathname.startsWith("/estoque")) return "estoque";
  if (pathname.startsWith("/tarefas")) return "tarefas";
  if (pathname.startsWith("/mensagens") || pathname.startsWith("/demandas")) return "mensagens";
  if (pathname.startsWith("/configuracoes")) return "configuracoes";
  return "dashboard";
};

// Mantém em sincronia com SETOR_MODULE_MAP em TopNavigation.tsx
function normalizeSetor(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ç/g, "c")
    .replace(/[._\-/]+/g, " ")
    .replace(/\b(dpto|depto|departamento|setor)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SETOR_ROUTES_MAP: Record<string, string[]> = {
  financeiro: ["/financeiro", "/tarefas", "/mensagens"],
  ti: ["/ti", "/tarefas", "/mensagens"],
  atendimento: ["/crm", "/tarefas", "/mensagens"],
  loja: ["/lojas", "/mensagens"],
  "atendimento corporativo": ["/interno", "/mensagens"],
  armacoes: ["/estoque", "/mensagens", "/tarefas"],
  "estoque armacoes": ["/estoque", "/mensagens", "/tarefas"],
  estoque: ["/estoque", "/mensagens", "/tarefas"],
};
const DEFAULT_SETOR_ROUTES = ["/interno", "/mensagens", "/tarefas", "/demandas"];

export function AppLayout() {
  const location = useLocation();
  const activeModule = useMemo(() => moduleFromPath(location.pathname), [location.pathname]);
  const { isAdmin, isOperador, roles, profile, isAuthReady, setores } = useAuth();

  // Toast + bipe in-app para novas mensagens em atendimento humano (push de background é tratado pelo SW).
  useAtendimentoNotifier();

  // Setor "efetivo": user_roles OU profile.setor_id (fallback p/ SSO/cross-login).
  const hasEffectiveSetor =
    roles.some((r) => r.setor_id) || Boolean(profile?.setor_id);
  const isSetorOnly = isAuthReady && !isAdmin && !isOperador && hasEffectiveSetor;

  // Rotas liberadas conforme os setores do usuário (mesmo mapa do TopNavigation).
  const allowedRoutes = useMemo(() => {
    const set = new Set<string>(["/tarefas", "/mensagens", "/demandas"]);
    if (setores && setores.length > 0) {
      for (const s of setores) {
        const key = normalizeSetor(s.nome);
        const mapped = SETOR_ROUTES_MAP[key] ?? DEFAULT_SETOR_ROUTES;
        mapped.forEach((r) => set.add(r));
      }
    } else {
      DEFAULT_SETOR_ROUTES.forEach((r) => set.add(r));
    }
    return Array.from(set);
  }, [setores]);

  // Default route: primeira rota não-genérica do setor (ex.: /financeiro), senão /interno.
  const defaultSetorRoute = useMemo(() => {
    const generic = new Set(["/tarefas", "/mensagens", "/demandas"]);
    return allowedRoutes.find((r) => !generic.has(r)) || "/interno";
  }, [allowedRoutes]);

  const isAllowedSetorRoute = allowedRoutes.some(
    (path) => location.pathname === path || location.pathname.startsWith(`${path}/`)
  );

  // Só redireciona depois que auth está pronto, para evitar race em SSO/cross-login.
  if (isAuthReady && isSetorOnly && !isAllowedSetorRoute) {
    return <Navigate to={defaultSetorRoute} replace />;
  }

  return (
    <SidebarProvider style={{ "--sidebar-width": "12rem" } as React.CSSProperties}>
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
