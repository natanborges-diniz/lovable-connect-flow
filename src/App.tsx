import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { AppLayout } from "@/components/layout/AppLayout";
import Dashboard from "./pages/Dashboard";
import Contatos from "./pages/Contatos";
import Pipeline from "./pages/Pipeline";
import PipelineFinanceiro from "./pages/PipelineFinanceiro";
import Solicitacoes from "./pages/Solicitacoes";
import Atendimentos from "./pages/Atendimentos";
import Tarefas from "./pages/Tarefas";
import Configuracoes from "./pages/Configuracoes";
import Auth from "./pages/Auth";
import ResetPassword from "./pages/ResetPassword";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/crm" element={<Pipeline />} />
              <Route path="/financeiro" element={<PipelineFinanceiro />} />
              <Route path="/crm/contatos" element={<Contatos />} />
              <Route path="/solicitacoes" element={<Solicitacoes />} />
              <Route path="/atendimentos" element={<Atendimentos />} />
              <Route path="/tarefas" element={<Tarefas />} />
              <Route path="/configuracoes" element={<Configuracoes />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
