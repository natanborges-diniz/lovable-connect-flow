import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, Headphones } from "lucide-react";

export default function Auth() {
  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Painel de marca (esquerda em desktop, topo em mobile) */}
      <div className="relative flex-1 flex items-center justify-center px-6 py-12 lg:py-0 overflow-hidden bg-gradient-to-br from-brand via-brand-hover to-neutral-900">
        {/* Decorativos */}
        <div className="absolute -top-24 -left-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" aria-hidden />
        <div className="absolute -bottom-32 -right-16 h-80 w-80 rounded-full bg-white/5 blur-3xl" aria-hidden />

        <div className="relative z-10 max-w-md text-brand-foreground">
          <div className="flex items-center gap-3 mb-6">
            <div className="h-12 w-12 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center ring-1 ring-white/20">
              <Headphones className="h-6 w-6" />
            </div>
            <div>
              <div className="text-2xl font-bold tracking-wide leading-none">
                INFOCO <span className="font-light opacity-80">OPS</span>
              </div>
              <div className="text-xs uppercase tracking-[0.2em] opacity-70 mt-1">Optical Business</div>
            </div>
          </div>
          <h2 className="text-3xl lg:text-4xl font-bold leading-tight mb-3">
            Plataforma de Comunicação<br />e Operações
          </h2>
          <p className="text-base opacity-80 leading-relaxed">
            CRM, Atendimento, Lojas, Financeiro e TI integrados em um único lugar — com IA Gael e WhatsApp oficial Meta.
          </p>
        </div>
      </div>

      {/* Painel de login (direita em desktop, abaixo em mobile) */}
      <div className="flex-1 flex items-center justify-center px-4 py-12 bg-app-bg">
        <div className="w-full max-w-md">
          <LoginForm />
        </div>
      </div>
    </div>
  );
}

function LoginForm() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      toast.error(error.message === "Invalid login credentials" ? "E-mail ou senha incorretos" : error.message);
    } else {
      navigate("/");
    }
    setLoading(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Entrar</CardTitle>
        <CardDescription>Faça login com seu e-mail e senha</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="login-email">E-mail</Label>
            <Input id="login-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="seu@email.com" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="login-password">Senha</Label>
            <Input id="login-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="••••••••" />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Entrando...</> : "Entrar"}
          </Button>
          <Button
            type="button"
            variant="link"
            className="w-full text-sm text-muted-foreground"
            onClick={async () => {
              if (!email) {
                toast.error("Digite seu e-mail primeiro");
                return;
              }
              const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: `${window.location.origin}/reset-password`,
              });
              if (error) {
                toast.error(error.message);
              } else {
                toast.success("E-mail de recuperação enviado! Verifique sua caixa de entrada.");
              }
            }}
          >
            Esqueci minha senha
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
