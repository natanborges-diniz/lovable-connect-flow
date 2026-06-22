import { useState } from "react";
import { useAuditoriaCashback, useAprovarDivergencia, useCancelarInscricaoCashback, useReprocessarReconciliacao } from "@/hooks/useCashbackAuditoria";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw, Check, X, FileSignature } from "lucide-react";
import { format } from "date-fns";

const fmt = (n: number | null) => (n == null ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));

export default function AuditoriaDivergencias() {
  const [filtro, setFiltro] = useState<"divergente" | "sem_venda_persistente" | "todas">("divergente");
  const { data: rows = [], isLoading } = useAuditoriaCashback(filtro);
  const aprovar = useAprovarDivergencia();
  const cancelar = useCancelarInscricaoCashback();
  const reproc = useReprocessarReconciliacao();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Auditoria de Cashback</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Tratamento manual silencioso — o cliente não é notificado em nenhuma ação.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => reproc.mutate()} disabled={reproc.isPending}>
          <RefreshCw className={`mr-2 h-4 w-4 ${reproc.isPending ? "animate-spin" : ""}`} />
          Reprocessar agora
        </Button>
      </CardHeader>
      <CardContent>
        <Tabs value={filtro} onValueChange={(v) => setFiltro(v as typeof filtro)}>
          <TabsList>
            <TabsTrigger value="divergente">Divergentes</TabsTrigger>
            <TabsTrigger value="sem_venda_persistente">Sem venda</TabsTrigger>
            <TabsTrigger value="todas">Todas pendentes</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="mt-4 rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Venda</TableHead>
                <TableHead>Loja</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead className="text-right">Lançado</TableHead>
                <TableHead className="text-right">Sistema</TableHead>
                <TableHead className="text-right">Δ</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-center">Tent.</TableHead>
                <TableHead>Última</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-6">Carregando…</TableCell></TableRow>
              )}
              {!isLoading && rows.length === 0 && (
                <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-6">Nada pendente 🎉</TableCell></TableRow>
              )}
              {rows.map((r) => {
                const lanc = Number(r.valor_total_informado ?? 0);
                const sis = Number(r.valor_total_validado ?? 0);
                const diff = sis - lanc;
                const isDiverg = r.valor_status === "divergente";
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.numero_venda}</TableCell>
                    <TableCell className="text-xs">{r.cod_empresa ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.nome_cliente ?? "—"}</TableCell>
                    <TableCell className="text-right text-xs">{fmt(lanc)}</TableCell>
                    <TableCell className="text-right text-xs">{r.valor_total_validado != null ? fmt(sis) : "—"}</TableCell>
                    <TableCell className={`text-right text-xs ${diff < 0 ? "text-red-600" : "text-emerald-600"}`}>
                      {r.valor_total_validado != null ? fmt(diff) : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={isDiverg ? "destructive" : "outline"}>{r.valor_status}</Badge>
                    </TableCell>
                    <TableCell className="text-center text-xs">{r.tentativas_reconciliacao ?? 0}</TableCell>
                    <TableCell className="text-xs">
                      {r.ultima_tentativa_at ? format(new Date(r.ultima_tentativa_at), "dd/MM HH:mm") : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {isDiverg && (
                          <>
                            <Button size="sm" variant="default" disabled={aprovar.isPending}
                              onClick={() => aprovar.mutate({ inscricao_id: r.id, valor_aceito: sis, origem: "supervisor_aprovou_sistema" })}>
                              <Check className="h-3 w-3" /> Sistema
                            </Button>
                            <Button size="sm" variant="outline" disabled={aprovar.isPending}
                              onClick={() => aprovar.mutate({ inscricao_id: r.id, valor_aceito: lanc, origem: "supervisor_aprovou_lancado" })}>
                              <FileSignature className="h-3 w-3" /> Lançado
                            </Button>
                          </>
                        )}
                        <Button size="sm" variant="ghost" disabled={cancelar.isPending}
                          onClick={() => {
                            if (confirm("Cancelar inscrição e estornar o crédito provisório?")) {
                              cancelar.mutate({ inscricao_id: r.id, motivo: "Cancelado pelo supervisor" });
                            }
                          }}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
