import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CashbackPinDialog } from "@/components/cashback/CashbackPinDialog";
import { ChevronDown, ChevronRight, Search } from "lucide-react";

const onlyDigits = (s: string) => (s || "").replace(/\D+/g, "");

function isValidCPF(cpf: string): boolean {
  const c = onlyDigits(cpf);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(c[i]) * (10 - i);
  let d1 = (sum * 10) % 11;
  if (d1 === 10) d1 = 0;
  if (d1 !== parseInt(c[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(c[i]) * (11 - i);
  let d2 = (sum * 10) % 11;
  if (d2 === 10) d2 = 0;
  return d2 === parseInt(c[10]);
}

const formatCPF = (v: string) => {
  const c = onlyDigits(v).slice(0, 11);
  return c
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
};

const formatPhone = (v: string) => {
  const d = onlyDigits(v).slice(0, 11);
  if (d.length <= 10) {
    return d.replace(/^(\d{0,2})(\d{0,4})(\d{0,4}).*/, (_, a, b, c) =>
      [a && `(${a}`, a && a.length === 2 ? ") " : "", b, c && `-${c}`].filter(Boolean).join("")
    );
  }
  return d.replace(/^(\d{2})(\d{5})(\d{4}).*/, "($1) $2-$3");
};

export default function ReguaNovaVenda() {
  const { user, profile, getUserLojaNames } = useAuth();
  const qc = useQueryClient();

  const [nome, setNome] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [cpf, setCpf] = useState("");
  const [numeroVenda, setNumeroVenda] = useState("");
  const [valor, setValor] = useState("");
  const [pinInscricaoId, setPinInscricaoId] = useState<string | null>(null);
  const [pinNomeCliente, setPinNomeCliente] = useState("");

  const lojaUsuario = getUserLojaNames()[0] || profile?.lojas?.[0] || null;

  const [busca, setBusca] = useState("");
  const [buscaAtiva, setBuscaAtiva] = useState("");
  const [expandido, setExpandido] = useState<Record<string, boolean>>({});

  const { data: clientes, isLoading } = useQuery({
    queryKey: ["cashback_clientes_consolidado", buscaAtiva],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("cashback_clientes_consolidado", {
        _busca: buscaAtiva || null,
        _lojas: null,
        _limit: 200,
      });
      if (error) throw error;
      return (data as any[]) || [];
    },
  });

  const brl = (v: any) =>
    Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const fmtCpf = (v?: string | null) => (v ? formatCPF(v) : "-");
  const fmtFone = (v?: string | null) => (v ? formatPhone(v) : "-");
  const fmtData = (v?: string | null) =>
    v ? new Date(v + (v.length === 10 ? "T00:00:00" : "")).toLocaleDateString("pt-BR") : "-";

  const salvar = useMutation({
    mutationFn: async () => {
      const cpfDigits = onlyDigits(cpf);
      const whatsDigits = onlyDigits(whatsapp);
      const valorNum = Number(valor.replace(",", "."));

      if (!nome.trim()) throw new Error("Informe o nome do cliente");
      if (whatsDigits.length < 10) throw new Error("WhatsApp inválido");
      if (!isValidCPF(cpfDigits)) throw new Error("CPF inválido");
      if (!numeroVenda.trim()) throw new Error("Informe o número da venda");
      if (!Number.isFinite(valorNum) || valorNum <= 0) throw new Error("Valor inválido");

      const { data, error } = await supabase.rpc("regua_registrar_venda", {
        p_nome: nome.trim(),
        p_whatsapp_digits: whatsDigits,
        p_cpf_digits: cpfDigits,
        p_numero_venda: numeroVenda.trim(),
        p_valor: valorNum,
        p_cod_empresa: lojaUsuario,
        p_usuario_lancamento: profile?.nome || user?.email || null,
      });
      if (error) throw error;
      return data as unknown as { ja_existia: boolean; inscricao_id: string; contato_id: string };
    },
    onSuccess: (res) => {
      if (res?.ja_existia) {
        toast.warning(`Já existe inscrição para a venda ${numeroVenda.trim()}`);
        return;
      }
      toast.success("Venda cadastrada — enviando PIN ao cliente...");
      setPinNomeCliente(nome.trim());
      setPinInscricaoId(res.inscricao_id);
      setNome("");
      setWhatsapp("");
      setCpf("");
      setNumeroVenda("");
      setValor("");
      qc.invalidateQueries({ queryKey: ["cashback_clientes_consolidado"] });
    },
    onError: (e: any) => toast.error(e.message || "Erro ao cadastrar"),
  });

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold">Novo cliente (cashback)</h1>
        <p className="text-sm text-muted-foreground">
          Cadastro do cliente e da venda para iniciar a régua de cashback.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Dados da venda</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid grid-cols-1 md:grid-cols-2 gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              salvar.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="nome">Nome do cliente *</Label>
              <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="whatsapp">WhatsApp *</Label>
              <Input
                id="whatsapp"
                value={whatsapp}
                onChange={(e) => setWhatsapp(formatPhone(e.target.value))}
                placeholder="(11) 99999-9999"
                inputMode="tel"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cpf">CPF *</Label>
              <Input
                id="cpf"
                value={cpf}
                onChange={(e) => setCpf(formatCPF(e.target.value))}
                placeholder="000.000.000-00"
                inputMode="numeric"
              />
              {cpf && !isValidCPF(cpf) && (
                <p className="text-xs text-destructive">CPF inválido</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="numero">Número da venda *</Label>
              <Input id="numero" value={numeroVenda} onChange={(e) => setNumeroVenda(e.target.value)} maxLength={40} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="valor">Valor total da venda (R$) *</Label>
              <Input
                id="valor"
                value={valor}
                onChange={(e) => setValor(e.target.value.replace(/[^\d.,]/g, ""))}
                placeholder="0,00"
                inputMode="decimal"
              />
            </div>
            <div className="space-y-2">
              <Label>Loja</Label>
              <Input value={lojaUsuario || "(sem loja vinculada)"} disabled />
            </div>

            <div className="md:col-span-2 flex justify-end gap-2">
              <Button type="submit" disabled={salvar.isPending}>
                {salvar.isPending ? "Salvando..." : "Cadastrar venda"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>Clientes na régua</CardTitle>
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setBuscaAtiva(busca.trim());
            }}
          >
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Nome, CPF ou telefone"
                className="pl-8 w-64"
              />
            </div>
            <Button type="submit" variant="secondary" size="sm">
              Buscar
            </Button>
            {buscaAtiva && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setBusca("");
                  setBuscaAtiva("");
                }}
              >
                Limpar
              </Button>
            )}
          </form>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : !clientes || clientes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {buscaAtiva ? "Nenhum cliente encontrado para a busca." : "Nenhum cliente cadastrado ainda."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>CPF</TableHead>
                  <TableHead>WhatsApp</TableHead>
                  <TableHead className="text-right">Vendas</TableHead>
                  <TableHead className="text-right">A vencer</TableHead>
                  <TableHead className="text-right">Vencido</TableHead>
                  <TableHead className="text-right">Utilizado</TableHead>
                  <TableHead>Próx. vencimento</TableHead>
                  <TableHead>Loja</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clientes.map((c: any) => {
                  const open = !!expandido[c.contato_id];
                  return (
                    <>
                      <TableRow
                        key={c.contato_id}
                        className="cursor-pointer"
                        onClick={() =>
                          setExpandido((prev) => ({ ...prev, [c.contato_id]: !prev[c.contato_id] }))
                        }
                      >
                        <TableCell>
                          {open ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </TableCell>
                        <TableCell className="font-medium">{c.nome || "-"}</TableCell>
                        <TableCell className="font-mono text-xs">{fmtCpf(c.cpf)}</TableCell>
                        <TableCell className="font-mono text-xs">{fmtFone(c.whatsapp)}</TableCell>
                        <TableCell className="text-right">
                          <div>{c.total_vendas}</div>
                          <div className="text-xs text-muted-foreground">
                            {brl(c.valor_total_vendas)}
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-emerald-600 font-medium">
                          {brl(c.saldo_a_vencer)}
                        </TableCell>
                        <TableCell className="text-right text-destructive font-medium">
                          {brl(c.saldo_vencido)}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {brl(c.saldo_utilizado)}
                        </TableCell>
                        <TableCell>{fmtData(c.proxima_expiracao)}</TableCell>
                        <TableCell className="text-xs">{c.ultima_loja || "-"}</TableCell>
                      </TableRow>
                      {open && (
                        <TableRow key={`${c.contato_id}-det`}>
                          <TableCell colSpan={10} className="bg-muted/30">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 py-3">
                              <div>
                                <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                                  Créditos
                                </div>
                                {(!c.creditos || c.creditos.length === 0) ? (
                                  <p className="text-xs text-muted-foreground">
                                    Nenhum crédito lançado.
                                  </p>
                                ) : (
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead className="h-8">Gerado</TableHead>
                                        <TableHead className="h-8">Vence</TableHead>
                                        <TableHead className="h-8 text-right">Valor</TableHead>
                                        <TableHead className="h-8 text-right">Saldo</TableHead>
                                        <TableHead className="h-8">Status</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {c.creditos.map((cr: any) => (
                                        <TableRow key={cr.id}>
                                          <TableCell className="text-xs">
                                            {fmtData(cr.data_geracao)}
                                          </TableCell>
                                          <TableCell
                                            className={
                                              "text-xs " +
                                              (cr.vencido ? "text-destructive font-medium" : "")
                                            }
                                          >
                                            {fmtData(cr.data_expiracao)}
                                          </TableCell>
                                          <TableCell className="text-xs text-right">
                                            {brl(cr.valor_gerado)}
                                          </TableCell>
                                          <TableCell className="text-xs text-right">
                                            {brl(cr.saldo)}
                                          </TableCell>
                                          <TableCell>
                                            <Badge
                                              variant={
                                                cr.vencido
                                                  ? "destructive"
                                                  : cr.status === "ativo"
                                                  ? "default"
                                                  : "outline"
                                              }
                                            >
                                              {cr.vencido ? "vencido" : cr.status}
                                            </Badge>
                                          </TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                )}
                              </div>
                              <div>
                                <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                                  Vendas
                                </div>
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead className="h-8">Nº Venda</TableHead>
                                      <TableHead className="h-8 text-right">Valor</TableHead>
                                      <TableHead className="h-8">PIN</TableHead>
                                      <TableHead className="h-8">Status</TableHead>
                                      <TableHead className="h-8">Data</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {(c.vendas || []).map((v: any) => (
                                      <TableRow key={v.inscricao_id}>
                                        <TableCell className="font-mono text-xs">
                                          {v.numero_venda}
                                        </TableCell>
                                        <TableCell className="text-xs text-right">
                                          {brl(v.valor)}
                                        </TableCell>
                                        <TableCell>
                                          <Badge
                                            variant={
                                              v.pin_confirmado_at ? "default" : "outline"
                                            }
                                          >
                                            {v.pin_confirmado_at ? "confirmado" : "pendente"}
                                          </Badge>
                                        </TableCell>
                                        <TableCell>
                                          <Badge variant="secondary">{v.status}</Badge>
                                        </TableCell>
                                        <TableCell className="text-xs text-muted-foreground">
                                          {new Date(v.criado_em).toLocaleDateString("pt-BR")}
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CashbackPinDialog
        inscricaoId={pinInscricaoId}
        nomeCliente={pinNomeCliente}
        onClose={() => setPinInscricaoId(null)}
        onConfirmed={() => {
          setPinInscricaoId(null);
          qc.invalidateQueries({ queryKey: ["regua_inscricao_list"] });
        }}
      />
    </div>
  );
}
