import { useState } from "react";
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

  const { data: inscricoes, isLoading } = useQuery({
    queryKey: ["regua_inscricao_list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("regua_inscricao")
        .select("id, nome_cliente, numero_venda, valor_total_informado, status, consentimento_status, criado_em, cod_empresa")
        .order("criado_em", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data || [];
    },
  });

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
      toast.success("Venda cadastrada na régua");
      setNome("");
      setWhatsapp("");
      setCpf("");
      setNumeroVenda("");
      setValor("");
      qc.invalidateQueries({ queryKey: ["regua_inscricao_list"] });
    },
    onError: (e: any) => toast.error(e.message || "Erro ao cadastrar"),
  });

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold">Nova venda (régua)</h1>
        <p className="text-sm text-muted-foreground">
          Cadastro de venda para a régua de relacionamento pós-venda.
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
        <CardHeader>
          <CardTitle>Vendas na régua</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : !inscricoes || inscricoes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma venda cadastrada ainda.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Nº Venda</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Consentimento</TableHead>
                  <TableHead>Loja</TableHead>
                  <TableHead>Criado em</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inscricoes.map((i: any) => (
                  <TableRow key={i.id}>
                    <TableCell>{i.nome_cliente || "-"}</TableCell>
                    <TableCell className="font-mono text-xs">{i.numero_venda}</TableCell>
                    <TableCell>
                      {i.valor_total_informado != null
                        ? Number(i.valor_total_informado).toLocaleString("pt-BR", {
                            style: "currency",
                            currency: "BRL",
                          })
                        : "-"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{i.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={i.consentimento_status === "aceito" ? "default" : "outline"}>
                        {i.consentimento_status}
                      </Badge>
                    </TableCell>
                    <TableCell>{i.cod_empresa || "-"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(i.criado_em).toLocaleString("pt-BR")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
