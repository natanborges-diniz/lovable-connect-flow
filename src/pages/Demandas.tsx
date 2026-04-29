import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Pin, Search, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useDemandas, useUserContext, type DemandaRow } from "@/hooks/useDemandas";
import { DemandaThreadView } from "@/components/atendimentos/DemandaThreadView";

export default function Demandas() {
  const [params, setParams] = useSearchParams();
  const initialId = params.get("demanda");
  const [selectedId, setSelectedId] = useState<string | null>(initialId);
  const [statusTab, setStatusTab] = useState<string>("aberta");
  const [search, setSearch] = useState("");
  const { isAdmin } = useUserContext();
  const { data: demandas = [], isLoading } = useDemandas({ status: statusTab });

  const filtered = useMemo(() => {
    if (!search.trim()) return demandas;
    const s = search.toLowerCase();
    return demandas.filter(
      (d) =>
        (d.protocolo ?? "").toLowerCase().includes(s) ||
        d.loja_nome.toLowerCase().includes(s) ||
        d.pergunta.toLowerCase().includes(s) ||
        (d.assunto ?? "").toLowerCase().includes(s),
    );
  }, [demandas, search]);

  const selected = filtered.find((d) => d.id === selectedId) ?? demandas.find((d) => d.id === selectedId) ?? null;

  const handleSelect = (id: string) => {
    setSelectedId(id);
    const next = new URLSearchParams(params);
    next.set("demanda", id);
    setParams(next, { replace: true });
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-3 p-3 md:p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Pin className="h-5 w-5 text-primary" /> Demandas
          </h1>
          <p className="text-xs text-muted-foreground">
            {isAdmin ? "Visão completa (admin)" : "Demandas do seu setor e as abertas por você"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar protocolo, loja, assunto..."
              className="h-8 w-64 pl-7 text-sm"
            />
          </div>
        </div>
      </header>

      <Tabs value={statusTab} onValueChange={setStatusTab}>
        <TabsList className="h-8">
          <TabsTrigger value="aberta" className="text-xs">Abertas</TabsTrigger>
          <TabsTrigger value="respondida" className="text-xs">Respondidas</TabsTrigger>
          <TabsTrigger value="encerrada" className="text-xs">Encerradas</TabsTrigger>
          <TabsTrigger value="all" className="text-xs">Todas</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-[360px_1fr]">
        <Card className="flex min-h-0 flex-col overflow-hidden">
          <ScrollArea className="flex-1">
            {isLoading ? (
              <p className="p-4 text-xs text-muted-foreground">Carregando…</p>
            ) : filtered.length === 0 ? (
              <p className="p-4 text-xs text-muted-foreground">Nenhuma demanda nesta visão.</p>
            ) : (
              <ul className="divide-y">
                {filtered.map((d) => (
                  <li key={d.id}>
                    <DemandaListItem
                      d={d}
                      active={d.id === selectedId}
                      onSelect={() => handleSelect(d.id)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </Card>

        <Card className="flex min-h-0 flex-col overflow-hidden">
          {selected ? (
            <DemandaThreadView demanda={selected} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
              <Pin className="h-8 w-8 opacity-40" />
              <p className="text-sm">Selecione uma demanda para abrir a conversa.</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function DemandaListItem({ d, active, onSelect }: { d: DemandaRow; active: boolean; onSelect: () => void }) {
  const isGrupo = d.metadata?.grupo === true;
  const lojasCount = d.metadata?.lojas_nomes?.length ?? null;
  return (
    <button
      onClick={onSelect}
      className={cn(
        "block w-full px-3 py-2.5 text-left transition-colors hover:bg-muted/60",
        active && "bg-primary/5 ring-1 ring-inset ring-primary/30",
        !d.vista_pelo_operador && "border-l-2 border-primary",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium">
          #{d.numero_curto} • {isGrupo ? (
            <span className="inline-flex items-center gap-1">
              <Users className="h-3 w-3" /> Grupo ({lojasCount ?? "?"} lojas)
            </span>
          ) : d.loja_nome}
        </span>
        <Badge
          variant="outline"
          className={cn(
            "h-4 shrink-0 px-1 text-[9px]",
            d.status === "aberta" && "border-amber-500/50 text-amber-600",
            d.status === "respondida" && "border-emerald-500/50 text-emerald-600",
            d.status === "encerrada" && "border-muted-foreground/30 text-muted-foreground",
          )}
        >
          {d.status}
        </Badge>
      </div>
      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{d.assunto || d.pergunta}</p>
      <p className="mt-0.5 text-[10px] text-muted-foreground/70">
        {format(new Date(d.created_at), "dd/MM HH:mm", { locale: ptBR })}
        {d.solicitante_nome && ` • por ${d.solicitante_nome}`}
      </p>
    </button>
  );
}
