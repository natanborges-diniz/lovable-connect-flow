import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Wallet, Activity, Calendar, Phone, Mail, Download } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  useContato, useContatoKpis, useContatoTimeline,
  useContatoCanais, useContatoCashback, useContatoConsentimentos,
} from "@/hooks/useContato360";
import { TimelineFeed, FONTES_DISPONIVEIS } from "@/components/contato360/TimelineFeed";

const fmtMoney = (n: number | null | undefined) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(n || 0));

export default function ContatoDetalhe() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [filtros, setFiltros] = useState<string[]>([]);
  const [busca, setBusca] = useState("");

  const { data: contato, isLoading: loadingContato } = useContato(id);
  const { data: kpis } = useContatoKpis(id);
  const { data: timeline = [], isLoading: loadingTL } = useContatoTimeline(id, filtros);
  const { data: canais = [] } = useContatoCanais(id);
  const { data: cashback } = useContatoCashback(id);
  const { data: consentimentos = [] } = useContatoConsentimentos(id);

  const timelineFiltrada = busca
    ? timeline.filter(t =>
        t.titulo.toLowerCase().includes(busca.toLowerCase()) ||
        (t.descricao?.toLowerCase().includes(busca.toLowerCase())))
    : timeline;

  const toggleFiltro = (k: string) => {
    setFiltros(f => f.includes(k) ? f.filter(x => x !== k) : [...f, k]);
  };

  const exportCSV = () => {
    const rows = [["Data", "Categoria", "Título", "Descrição"]];
    timelineFiltrada.forEach(t => rows.push([
      format(new Date(t.ocorrido_at), "dd/MM/yyyy HH:mm"),
      t.fonte, t.titulo, t.descricao || "",
    ]));
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `cliente_${contato?.nome}_${Date.now()}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  if (loadingContato) return <div className="p-6">Carregando…</div>;
  if (!contato) return <div className="p-6">Cliente não encontrado.</div>;

  const canalPrincipal = canais.find((c: any) => c.principal) || canais[0];

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
        </Button>
      </div>

      {/* HEADER */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">{contato.nome}</h1>
              <div className="flex flex-wrap items-center gap-3 mt-1 text-sm text-muted-foreground">
                {contato.telefone && (<span className="flex items-center gap-1"><Phone className="h-3 w-3" />{contato.telefone}</span>)}
                {contato.email && (<span className="flex items-center gap-1"><Mail className="h-3 w-3" />{contato.email}</span>)}
                {contato.documento && <span>CPF: {contato.documento}</span>}
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                <Badge variant="outline">{contato.tipo}</Badge>
                <Badge variant="secondary">{contato.estagio}</Badge>
                {canalPrincipal && (
                  <Badge variant={canalPrincipal.status === "validado" ? "default" : "outline"}>
                    Canal: {canalPrincipal.status || "—"}
                  </Badge>
                )}
                {(contato.tags || []).map((t: string) => <Badge key={t} variant="outline">{t}</Badge>)}
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={exportCSV}>
              <Download className="h-4 w-4 mr-2" /> Exportar timeline
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI icon={Wallet} label="Cashback ativo" value={fmtMoney(kpis?.cashback_saldo)} />
        <KPI icon={Activity} label="LTV estimado" value={fmtMoney(kpis?.ltv)} />
        <KPI icon={Calendar} label="Atendimentos" value={String(kpis?.atendimentos_total ?? 0)} />
        <KPI icon={Calendar} label="Última interação" value={
          kpis?.ultima_interacao ? format(new Date(kpis.ultima_interacao), "dd/MM HH:mm", { locale: ptBR }) : "—"
        } />
      </div>

      {/* TABS */}
      <Tabs defaultValue="timeline" className="w-full">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="cashback">Cashback</TabsTrigger>
          <TabsTrigger value="lgpd">LGPD / Documentos</TabsTrigger>
          <TabsTrigger value="canais">Canais</TabsTrigger>
        </TabsList>

        <TabsContent value="timeline" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Buscar na timeline…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="max-w-sm h-8"
            />
            <div className="flex flex-wrap gap-1">
              {FONTES_DISPONIVEIS.map(f => (
                <Badge
                  key={f.key}
                  variant={filtros.includes(f.key) ? "default" : "outline"}
                  className="cursor-pointer text-[10px]"
                  onClick={() => toggleFiltro(f.key)}
                >
                  {f.label}
                </Badge>
              ))}
              {filtros.length > 0 && (
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setFiltros([])}>limpar</Button>
              )}
            </div>
          </div>
          <Card>
            <CardContent className="pt-4 max-h-[70vh] overflow-y-auto">
              <TimelineFeed items={timelineFiltrada} loading={loadingTL} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cashback">
          <Card>
            <CardHeader><CardTitle className="text-base">Créditos</CardTitle></CardHeader>
            <CardContent>
              {(cashback?.creditos || []).length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum cashback registrado.</p>
              ) : (
                <div className="divide-y">
                  {cashback!.creditos.map((c: any) => (
                    <div key={c.id} className="py-2 flex justify-between text-sm">
                      <div>
                        <p className="font-medium">{fmtMoney(c.valor_gerado)} <span className="text-xs text-muted-foreground">(saldo {fmtMoney(c.saldo)})</span></p>
                        <p className="text-xs text-muted-foreground">Gerado {format(new Date(c.criado_em), "dd/MM/yyyy")} • expira {c.data_expiracao ? format(new Date(c.data_expiracao), "dd/MM/yyyy") : "—"}</p>
                      </div>
                      <Badge variant={c.status === "ativo" ? "default" : "outline"}>{c.status}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <Card className="mt-3">
            <CardHeader><CardTitle className="text-base">Resgates</CardTitle></CardHeader>
            <CardContent>
              {(cashback?.resgates || []).length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum resgate.</p>
              ) : (
                <div className="divide-y">
                  {cashback!.resgates.map((r: any) => (
                    <div key={r.id} className="py-2 text-sm flex justify-between">
                      <span>{fmtMoney(r.valor_usado)} — venda {r.numero_venda_uso || "—"}</span>
                      <span className="text-xs text-muted-foreground">{format(new Date(r.data_uso), "dd/MM/yyyy")}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="lgpd">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Consentimentos LGPD</CardTitle>
            </CardHeader>
            <CardContent>
              {consentimentos.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum consentimento registrado.</p>
              ) : (
                <div className="divide-y">
                  {consentimentos.map((c: any) => (
                    <div key={c.id} className="py-3 text-sm">
                      <div className="flex items-baseline justify-between">
                        <p className="font-medium">Termos {c.termos_versao || "?"}</p>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(c.pin_confirmado_at), "dd/MM/yyyy HH:mm")}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Canal: {c.canal_consentimento || "—"} • Venda: {c.numero_venda || "—"} • IP consultor: {c.ip_origem_consultor || "—"}
                      </p>
                      <a href="/termos/cashback" target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
                        Ver termos vigentes →
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="canais">
          <Card>
            <CardHeader><CardTitle className="text-base">Saúde dos canais</CardTitle></CardHeader>
            <CardContent>
              {canais.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum canal cadastrado.</p>
              ) : (
                <div className="space-y-3">
                  {canais.map((c: any) => (
                    <div key={c.id} className="border rounded-md p-3">
                      <div className="flex items-baseline justify-between">
                        <p className="font-medium text-sm">{c.tipo} • {c.identificador} {c.principal && <Badge variant="outline" className="ml-1 text-[10px]">principal</Badge>}</p>
                        <Badge variant={c.status === "validado" ? "default" : c.status === "pessoa_errada" || c.status === "invalido" ? "destructive" : "outline"}>
                          {c.status || "nao_validado"}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-4 gap-2 mt-2 text-center text-xs">
                        <div><div className="font-semibold">{c.tentativas_enviadas || 0}</div><div className="text-muted-foreground">enviadas</div></div>
                        <div><div className="font-semibold">{c.tentativas_entregues || 0}</div><div className="text-muted-foreground">entregues</div></div>
                        <div><div className="font-semibold">{c.tentativas_lidas || 0}</div><div className="text-muted-foreground">lidas</div></div>
                        <div><div className="font-semibold">{c.tentativas_respondidas || 0}</div><div className="text-muted-foreground">respondidas</div></div>
                      </div>
                      {c.ultimo_motivo_falha && (
                        <p className="text-xs text-destructive mt-2">Última falha: {c.ultimo_motivo_falha} {c.ultima_falha_at && `(${format(new Date(c.ultima_falha_at), "dd/MM HH:mm")})`}</p>
                      )}
                      {c.validado_at && (
                        <p className="text-xs text-muted-foreground mt-1">Validado em {format(new Date(c.validado_at), "dd/MM/yyyy HH:mm")} • Termos {c.termos_versao || "—"}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function KPI({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
          <Icon className="h-3.5 w-3.5" /> {label}
        </div>
        <p className="text-xl font-bold mt-1">{value}</p>
      </CardContent>
    </Card>
  );
}
