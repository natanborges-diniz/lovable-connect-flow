import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Download, MessageSquare, Search } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DisparoStatusBadge } from "@/components/relatorios/DisparoStatusBadge";
import { useDisparosKpis, useDisparosListar, type DisparoRow } from "@/hooks/useDisparos";

const FONTE_OPTIONS = [
  { value: "armacao", label: "Aguardando armação" },
  { value: "entrega", label: "Entrega de óculos" },
  { value: "regua", label: "Régua / Cashback" },
  { value: "pagamento", label: "Link de pagamento" },
  { value: "cashback", label: "Cashback" },
  { value: "agendamento", label: "Agendamento" },
  { value: "recuperacao", label: "Recuperação IA" },
  { value: "escalada", label: "Escalada" },
  { value: "outro", label: "Outros" },
];

const STATUS_OPTIONS = [
  { value: "sent", label: "Enviada" },
  { value: "delivered", label: "Entregue" },
  { value: "read", label: "Lida" },
  { value: "failed", label: "Falhou" },
  { value: "invalid_number", label: "Número inválido" },
];

const PERIODOS = [
  { value: 1, label: "Últimas 24h" },
  { value: 7, label: "Últimos 7 dias" },
  { value: 15, label: "Últimos 15 dias" },
  { value: 30, label: "Últimos 30 dias" },
  { value: 90, label: "Últimos 90 dias" },
];

function csvEscape(v: unknown): string {
  if (v == null) return "";
  const s = String(v).replace(/"/g, '""');
  return /[",\n;]/.test(s) ? `"${s}"` : s;
}

function exportCsv(rows: DisparoRow[]) {
  const headers = ["enviado_at", "fonte", "template", "cliente", "telefone", "loja", "status", "falha_motivo", "atendimento_id"];
  const lines = [headers.join(";")];
  for (const r of rows) {
    lines.push([
      r.enviado_at, r.fonte, r.template_nome, r.cliente_nome, r.telefone, r.loja_nome, r.wa_status, r.falha_motivo, r.atendimento_id,
    ].map(csvEscape).join(";"));
  }
  const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `disparos_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function RelatorioDisparos() {
  const navigate = useNavigate();
  const [periodo, setPeriodo] = useState(7);
  const [fonte, setFonte] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(1);
  const porPagina = 50;

  const fontesArr = fonte === "all" ? null : [fonte];
  const statusArr = status === "all" ? null : [status];

  const { data: kpis } = useDisparosKpis({ periodo_dias: periodo, fontes: fontesArr });
  const { data: rows = [], isLoading } = useDisparosListar({
    periodo_dias: periodo,
    fontes: fontesArr,
    status: statusArr,
    busca,
    pagina,
    por_pagina: porPagina,
  });

  const kpiCards = useMemo(() => ([
    { label: "Total enviados", value: kpis?.total ?? 0, suffix: "" },
    { label: "Taxa de entrega", value: kpis?.taxa_entrega ?? 0, suffix: "%" },
    { label: "Taxa de leitura", value: kpis?.taxa_leitura ?? 0, suffix: "%" },
    { label: "Resposta em 24h", value: kpis?.taxa_resposta_24h ?? 0, suffix: "%" },
    { label: "Número inválido", value: kpis?.taxa_invalido ?? 0, suffix: "%" },
  ]), [kpis]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Disparos CRM"
        description="Painel consolidado de mensagens enviadas pelo CRM com status de entrega, leitura e resposta"
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {kpiCards.map((c) => (
          <Card key={c.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-muted-foreground font-medium">{c.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">{c.value}{c.suffix}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <Select value={String(periodo)} onValueChange={(v) => { setPagina(1); setPeriodo(Number(v)); }}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PERIODOS.map((p) => <SelectItem key={p.value} value={String(p.value)}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={fonte} onValueChange={(v) => { setPagina(1); setFonte(v); }}>
              <SelectTrigger className="w-[200px]"><SelectValue placeholder="Fonte" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as fontes</SelectItem>
                {FONTE_OPTIONS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={status} onValueChange={(v) => { setPagina(1); setStatus(v); }}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                {STATUS_OPTIONS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>

            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Buscar cliente, telefone, template, loja…"
                value={busca}
                onChange={(e) => { setPagina(1); setBusca(e.target.value); }}
              />
            </div>

            <Button variant="outline" size="sm" onClick={() => exportCsv(rows)} disabled={!rows.length}>
              <Download className="h-4 w-4 mr-1" /> CSV
            </Button>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[140px]">Data</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Fonte / Template</TableHead>
                  <TableHead>Loja</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Falha</TableHead>
                  <TableHead className="w-[100px] text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Carregando…</TableCell></TableRow>
                )}
                {!isLoading && rows.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Sem disparos no período</TableCell></TableRow>
                )}
                {rows.map((r) => (
                  <TableRow key={`${r.fonte}-${r.id}`}>
                    <TableCell className="text-xs whitespace-nowrap">
                      {r.enviado_at ? format(new Date(r.enviado_at), "dd/MM HH:mm", { locale: ptBR }) : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-sm">{r.cliente_nome || "—"}</div>
                      <div className="text-xs text-muted-foreground">{r.telefone || "—"}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="capitalize">{r.fonte}</Badge>
                      <div className="text-xs text-muted-foreground mt-1">{r.template_nome || r.alias || "—"}</div>
                    </TableCell>
                    <TableCell className="text-sm">{r.loja_nome || "—"}</TableCell>
                    <TableCell><DisparoStatusBadge status={r.wa_status} /></TableCell>
                    <TableCell className="text-xs text-destructive max-w-[220px] truncate">{r.falha_motivo || ""}</TableCell>
                    <TableCell className="text-right">
                      {r.atendimento_id ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => navigate(`/crm/conversas?atendimento=${r.atendimento_id}`)}
                          title="Abrir conversa"
                        >
                          <MessageSquare className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Página {pagina} · {rows.length} registros</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={pagina <= 1} onClick={() => setPagina((p) => Math.max(1, p - 1))}>Anterior</Button>
              <Button variant="outline" size="sm" disabled={rows.length < porPagina} onClick={() => setPagina((p) => p + 1)}>Próxima</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
