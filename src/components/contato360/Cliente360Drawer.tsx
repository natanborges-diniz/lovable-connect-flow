import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ExternalLink, Wallet, Activity } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useContato, useContatoKpis, useContatoTimeline } from "@/hooks/useContato360";
import { TimelineFeed } from "./TimelineFeed";

const fmtMoney = (n: number | null | undefined) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(n || 0));

interface Props {
  contatoId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function Cliente360Drawer({ contatoId, open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const { data: contato } = useContato(contatoId || undefined);
  const { data: kpis } = useContatoKpis(contatoId || undefined);
  const { data: timeline = [], isLoading } = useContatoTimeline(contatoId || undefined);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{contato?.nome || "Cliente"}</SheetTitle>
        </SheetHeader>

        {contato && (
          <div className="mt-4 space-y-3">
            <div className="text-xs text-muted-foreground">
              {contato.telefone} {contato.email && `• ${contato.email}`}
            </div>
            <div className="flex flex-wrap gap-1">
              <Badge variant="outline">{contato.tipo}</Badge>
              <Badge variant="secondary">{contato.estagio}</Badge>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Card><CardContent className="pt-3 pb-2">
                <div className="flex items-center gap-1 text-[10px] uppercase text-muted-foreground"><Wallet className="h-3 w-3" />Cashback</div>
                <p className="text-sm font-bold">{fmtMoney(kpis?.cashback_saldo)}</p>
              </CardContent></Card>
              <Card><CardContent className="pt-3 pb-2">
                <div className="flex items-center gap-1 text-[10px] uppercase text-muted-foreground"><Activity className="h-3 w-3" />LTV</div>
                <p className="text-sm font-bold">{fmtMoney(kpis?.ltv)}</p>
              </CardContent></Card>
            </div>

            <Button
              variant="outline" size="sm" className="w-full"
              onClick={() => { onOpenChange(false); navigate(`/crm/contatos/${contatoId}`); }}
            >
              <ExternalLink className="h-4 w-4 mr-2" /> Abrir visão completa
            </Button>

            <div className="border-t pt-3">
              <p className="text-xs font-semibold text-muted-foreground mb-2">Últimas interações</p>
              <TimelineFeed items={timeline.slice(0, 20)} loading={isLoading} compact />
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
