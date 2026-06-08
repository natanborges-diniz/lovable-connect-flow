import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";
import { hasModulo, moduloFromRoute, MODULOS_ATRIUM, type Acessos, type ModuloKey } from "@/lib/acessos";

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: Array<"admin" | "operador" | "setor_usuario">;
}

// Encontra a primeira rota que o usuário tem acesso — evita loop de redirect para "/"
// quando o usuário não tem o módulo "dashboard".
function firstAllowedRoute(acessos: Acessos | null): string {
  if (!acessos) return "/somente-messenger";
  if (acessos.acessoTotal) return "/";
  for (const m of MODULOS_ATRIUM) {
    if (m.rota && m.rota !== "/" && hasModulo(acessos, m.key as ModuloKey)) {
      return m.rota;
    }
  }
  return "/somente-messenger";
}

export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { user, loading, roles, isAdmin, profile, acessos } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-app-bg">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  // tipo=loja só usa o InFoco Messenger; bloqueia Atrium web inteiro.
  // Exceção: Diretor (acesso_total) entra em qualquer rota.
  if (
    profile?.tipo_usuario === "loja" &&
    !acessos?.acessoTotal &&
    !location.pathname.startsWith("/somente-messenger")
  ) {
    return <Navigate to="/somente-messenger" replace />;
  }

  const fallback = firstAllowedRoute(acessos);
  const safeRedirect = (target: string) =>
    target === location.pathname ? "/somente-messenger" : target;

  // If roles are specified, check access (admins always pass).
  if (allowedRoles && !isAdmin && roles.length > 0) {
    const hasRoleAccess = roles.some((r) => allowedRoles.includes(r.role));
    const mod = moduloFromRoute(location.pathname);
    const hasModuloAccess =
      acessos?.acessoTotal || (mod ? hasModulo(acessos, mod) : false);
    if (!hasRoleAccess && !hasModuloAccess) {
      return <Navigate to={safeRedirect(fallback)} replace />;
    }
  }

  // Bloqueio por módulo (só quando user_acessos existe).
  if (acessos && !acessos.acessoTotal) {
    const mod = moduloFromRoute(location.pathname);
    if (mod && !hasModulo(acessos, mod)) {
      return <Navigate to={safeRedirect(fallback)} replace />;
    }
  }

  return <>{children}</>;
}
