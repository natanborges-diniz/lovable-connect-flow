import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Smartphone, LogOut, ExternalLink } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

const INFOCO_MESSENGER_URL = "https://desktop-joy-app.lovable.app";

export default function SomenteMessenger() {
  const { signOut, profile } = useAuth();
  return (
    <div className="min-h-screen flex items-center justify-center bg-app-bg p-4">
      <Card className="max-w-md w-full shadow-card">
        <CardContent className="p-8 text-center space-y-5">
          <div className="mx-auto w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
            <Smartphone className="w-7 h-7 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold mb-2">Olá{profile?.nome ? `, ${profile.nome.split(" ")[0]}` : ""}!</h1>
            <p className="text-sm text-muted-foreground">
              Seu acesso é exclusivo pelo aplicativo <strong>InFoco Messenger</strong>.
              Use o app para abrir demandas, conversar com setores e acompanhar respostas.
            </p>
          </div>
          <Button asChild className="w-full" size="lg">
            <a href={INFOCO_MESSENGER_URL} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-4 h-4 mr-2" />
              Abrir InFoco Messenger
            </a>
          </Button>
          <Button variant="ghost" size="sm" onClick={signOut} className="w-full">
            <LogOut className="w-4 h-4 mr-2" /> Sair
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
