import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";
import { hasModulo, moduloFromRoute } from "@/lib/acessos";

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: Array<"admin" | "operador" | "setor_usuario">;
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

  // If roles are specified, check access (admins always pass)
  if (allowedRoles && !isAdmin && roles.length > 0) {
    const hasAccess = roles.some((r) => allowedRoles.includes(r.role));
    if (!hasAccess) {
      return <Navigate to="/" replace />;
    }
  }

  // Bloqueio por módulo (só quando user_acessos existe).
  // Sem user_acessos cai no modelo antigo (AppLayout/role).
  if (acessos && !acessos.acessoTotal) {
    const mod = moduloFromRoute(location.pathname);
    if (mod && !hasModulo(acessos, mod)) {
      return <Navigate to="/" replace />;
    }
  }

  return <>{children}</>;
}
