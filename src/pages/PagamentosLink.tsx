import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Download, Search, ExternalLink } from "lucide-react";

type Pagamento = {
  id: string;
  payment_link_id: string;
  solicitacao_id: string | null;
  contato_id: string | null;
  loja_nome: string | null;
  cliente_nome: string | null;
  cliente_telefone: string | null;
  valor: number | null;
  parcelas: number | null;
  descricao: string | null;
  status: string;
  tid: string | null;
  nsu: string | null;
  authorization_code: string | null;
  last4: string | null;
  link_url: string | null;
  enviado_at: string | null;
  pago_at: string | null;
  comprovante_recebido_at: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
};

type Evento = {
  id: string;
  status_anterior: string | null;
  status_novo: string;
  created_at: string;
};

const STATUS_VARIANT: Record<string, { label: string; cls: string }> = {
  criado: { label: "Criado", cls: "bg-muted text-muted-foreground" },
  enviado: { label: "Enviado", cls: "bg-blue-500/15 text-blue-700 dark:text-blue-300" },
  visualizado: { label: "Visualizado", cls: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300" },
  pago: { label: "Pago", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  estornado: { label: "Estornado", cls: "bg-orange-500/15 text-orange-700 dark:text-orange-300" },
  expirado: { label: "Expirado", cls: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300" },
  falha_envio: { label: "Falha envio", cls: "bg-red-500/15 text-red-700 dark:text-red-300" },
};

function brl(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function PagamentosLink() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("todos");
  const [lojaFilter, setLojaFilter] = useState<string>("todas");
  const [selected, setSelected] = useState<Pagamento | null>(null);

  const { data: pagamentos = [], isLoading } = useQuery({
    queryKey: ["pagamentos_link"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pagamentos_link" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data || []) as unknown as Pagamento[];
    },
  });

  const { data: eventos = [] } = useQuery({
    queryKey: ["pagamentos_link_eventos", selected?.id],
    enabled: !!selected,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pagamentos_link_eventos" as any)
        .select("*")
        .eq("pagamento_id", selected!.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as Evento[];
    },
  });

  const lojas = useMemo(
    () => Array.from(new Set(pagamentos.map((p) => p.loja_nome).filter(Boolean) as string[])).sort(),
    [pagamentos],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return pagamentos.filter((p) => {
      if (statusFilter !== "todos" && p.status !== statusFilter) return false;
      if (lojaFilter !== "todas" && p.loja_nome !== lojaFilter) return false;
      if (!q) return true;
      return [
        p.cliente_nome, p.cliente_telefone, p.tid, p.nsu, p.descricao, p.payment_link_id,
      ].some((v) => v && String(v).toLowerCase().includes(q));
    });
  }, [pagamentos, search, statusFilter, lojaFilter]);

  const kpis = useMemo(() => {
    const enviados = pagamentos.filter((p) => ["enviado", "visualizado", "pago"].includes(p.status));
    const pagos = pagamentos.filter((p) => p.status === "pago");
    const totalEnviado = enviados.reduce((s, p) => s + (Number(p.valor) || 0), 0);
    const totalPago = pagos.reduce((s, p) => s + (Number(p.valor) || 0), 0);
    const ticket = pagos.length ? totalPago / pagos.length : 0;
    const conv = enviados.length ? (pagos.length / enviados.length) * 100 : 0;
    const pendentes24h = pagamentos.filter((p) => {
      if (!["criado", "enviado", "visualizado"].includes(p.status)) return false;
      const ref = p.enviado_at || p.created_at;
      return Date.now() - new Date(ref).getTime() > 24 * 3600 * 1000;
    }).length;
    return { totalEnviado, totalPago, ticket, conv, pendentes24h };
  }, [pagamentos]);

  function exportCsv() {
    const headers = [
      "payment_link_id", "status", "loja", "cliente", "telefone", "valor",
      "parcelas", "tid", "nsu", "last4", "criado_em", "pago_em",
    ];
    const rows = filtered.map((p) => [
      p.payment_link_id, p.status, p.loja_nome ?? "", p.cliente_nome ?? "",
      p.cliente_telefone ?? "", String(p.valor ?? ""), String(p.parcelas ?? ""),
      p.tid ?? "", p.nsu ?? "", p.last4 ?? "",
      p.created_at, p.pago_at ?? "",
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pagamentos_link_${format(new Date(), "yyyyMMdd_HHmm")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pagamentos via Link"
        description="Rastreabilidade de todos os links de pagamento enviados pelo WhatsApp"
        actions={
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="h-4 w-4 mr-2" /> Exportar CSV
          </Button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard label="Total enviado" value={brl(kpis.totalEnviado)} />
        <KpiCard label="Total pago" value={brl(kpis.totalPago)} highlight />
        <KpiCard label="Ticket médio" value={brl(kpis.ticket)} />
        <KpiCard label="Conversão" value={`${kpis.conv.toFixed(1)}%`} />
        <KpiCard label="Pendentes >24h" value={String(kpis.pendentes24h)} warn={kpis.pendentes24h > 0} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col md:flex-row gap-3 md:items-center">
            <div className="relative flex-1">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Cliente, telefone, TID, NSU…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full md:w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos status</SelectItem>
                {Object.entries(STATUS_VARIANT).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={lojaFilter} onValueChange={setLojaFilter}>
              <SelectTrigger className="w-full md:w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas lojas</SelectItem>
                {lojas.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Loja</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Parc.</TableHead>
                <TableHead>NSU</TableHead>
                <TableHead>Criado</TableHead>
                <TableHead>Pago</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Carregando…</TableCell></TableRow>
              )}
              {!isLoading && filtered.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Nenhum pagamento encontrado</TableCell></TableRow>
              )}
              {filtered.map((p) => {
                const sv = STATUS_VARIANT[p.status] || { label: p.status, cls: "bg-muted" };
                return (
                  <TableRow
                    key={p.id}
                    className="cursor-pointer hover:bg-accent/50"
                    onClick={() => setSelected(p)}
                  >
                    <TableCell><Badge className={sv.cls} variant="outline">{sv.label}</Badge></TableCell>
                    <TableCell>
                      <div className="font-medium">{p.cliente_nome || "—"}</div>
                      <div className="text-xs text-muted-foreground">{p.cliente_telefone || ""}</div>
                    </TableCell>
                    <TableCell className="text-sm">{p.loja_nome || "—"}</TableCell>
                    <TableCell className="text-right font-mono">{brl(Number(p.valor))}</TableCell>
                    <TableCell className="text-sm">{p.parcelas ? `${p.parcelas}x` : "—"}</TableCell>
                    <TableCell className="text-xs font-mono">{p.nsu || "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {format(new Date(p.created_at), "dd/MM HH:mm", { locale: ptBR })}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {p.pago_at ? format(new Date(p.pago_at), "dd/MM HH:mm", { locale: ptBR }) : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>Pagamento</SheetTitle>
              </SheetHeader>
              <div className="space-y-4 mt-4 text-sm">
                <div className="flex items-center gap-2">
                  <Badge className={(STATUS_VARIANT[selected.status] || {}).cls} variant="outline">
                    {(STATUS_VARIANT[selected.status] || { label: selected.status }).label}
                  </Badge>
                  <span className="font-mono text-xs text-muted-foreground">{selected.payment_link_id}</span>
                </div>

                <Field label="Cliente" value={`${selected.cliente_nome || "—"} (${selected.cliente_telefone || "—"})`} />
                <Field label="Loja" value={selected.loja_nome || "—"} />
                <Field label="Valor" value={`${brl(Number(selected.valor))}${selected.parcelas ? ` em ${selected.parcelas}x${(selected as any).metadata?.parcelas_fixas ? " (fixo)" : ""}` : ""}`} />
                <Field label="Descrição" value={selected.descricao || "—"} />
                <Field label="TID" value={selected.tid || "—"} mono />
                <Field label="NSU" value={selected.nsu || "—"} mono />
                <Field label="Autorização" value={selected.authorization_code || "—"} mono />
                <Field label="Cartão" value={selected.last4 ? `**** ${selected.last4}` : "—"} />

                {selected.link_url && (
                  <a
                    href={selected.link_url}
                    target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary text-xs hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" /> Abrir link de pagamento
                  </a>
                )}

                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-2">Linha do tempo</div>
                  <ol className="space-y-1.5 border-l border-border pl-3">
                    {eventos.map((e) => (
                      <li key={e.id} className="text-xs">
                        <span className="font-medium">{(STATUS_VARIANT[e.status_novo] || { label: e.status_novo }).label}</span>
                        {e.status_anterior && <span className="text-muted-foreground"> ← {e.status_anterior}</span>}
                        <div className="text-muted-foreground">
                          {format(new Date(e.created_at), "dd/MM/yyyy HH:mm:ss", { locale: ptBR })}
                        </div>
                      </li>
                    ))}
                    {eventos.length === 0 && <li className="text-xs text-muted-foreground">Sem eventos</li>}
                  </ol>
                </div>

                {selected.contato_id && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={`/crm/contatos?id=${selected.contato_id}`}>Ver contato no CRM</a>
                  </Button>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function KpiCard({ label, value, highlight, warn }: { label: string; value: string; highlight?: boolean; warn?: boolean }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-xl font-semibold mt-1 ${highlight ? "text-emerald-600 dark:text-emerald-400" : ""} ${warn ? "text-orange-600 dark:text-orange-400" : ""}`}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={mono ? "font-mono text-sm" : "text-sm"}>{value}</div>
    </div>
  );
}
