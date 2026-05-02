import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { CalendarDays, Plus, Trash2, Store } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Feriado = {
  id: string;
  data: string;
  nome: string;
  tipo: "nacional" | "estadual" | "municipal" | "interno";
  fecha_todas: boolean;
  recorrente: boolean;
  ativo: boolean;
};

type Loja = { id: string; nome_loja: string; tipo: string; ativo: boolean };

type Politica = {
  id: string;
  loja_id: string;
  escopo: "default_nacional" | "feriado_especifico";
  feriado_id: string | null;
  politica: "fechada" | "abre_horario_domingo" | "abre_horario_normal" | "abre_horario_customizado";
  ativo: boolean;
};

const POLITICA_LABEL: Record<Politica["politica"], string> = {
  fechada: "Fechada",
  abre_horario_domingo: "Abre no horário de domingo",
  abre_horario_normal: "Abre no horário normal",
  abre_horario_customizado: "Customizado",
};

export function FeriadosCard() {
  return (
    <div className="grid gap-6">
      <CalendarioFeriadosCard />
      <PoliticaPorLojaCard />
    </div>
  );
}

function CalendarioFeriadosCard() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ data: "", nome: "", tipo: "nacional", fecha_todas: false, recorrente: true });

  const { data: feriados } = useQuery({
    queryKey: ["feriados"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("feriados").select("*").order("data");
      if (error) throw error;
      return (data || []) as Feriado[];
    },
  });

  const create = useMutation({
    mutationFn: async (payload: typeof form) => {
      const { error } = await (supabase as any).from("feriados").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["feriados"] });
      toast.success("Feriado cadastrado");
      setOpen(false);
      setForm({ data: "", nome: "", tipo: "nacional", fecha_todas: false, recorrente: true });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: async ({ id, field, value }: { id: string; field: keyof Feriado; value: boolean }) => {
      const { error } = await (supabase as any).from("feriados").update({ [field]: value }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["feriados"] }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("feriados").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["feriados"] });
      toast.success("Feriado removido");
    },
  });

  return (
    <Card className="shadow-card">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg flex items-center gap-2">
          <CalendarDays className="h-5 w-5" /> Calendário de Feriados
        </CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" /> Novo Feriado
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Novo Feriado</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Data</Label>
                <Input type="date" value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Nome</Label>
                <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Ex.: Aniversário de Osasco" />
              </div>
              <div className="space-y-1">
                <Label>Tipo</Label>
                <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nacional">Nacional</SelectItem>
                    <SelectItem value="estadual">Estadual</SelectItem>
                    <SelectItem value="municipal">Municipal</SelectItem>
                    <SelectItem value="interno">Interno</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between">
                <Label>Fecha todas as lojas</Label>
                <Switch checked={form.fecha_todas} onCheckedChange={(v) => setForm({ ...form, fecha_todas: v })} />
              </div>
              <div className="flex items-center justify-between">
                <Label>Recorrente (todo ano)</Label>
                <Switch checked={form.recorrente} onCheckedChange={(v) => setForm({ ...form, recorrente: v })} />
              </div>
              <Button className="w-full" onClick={() => create.mutate(form)} disabled={!form.data || !form.nome || create.isPending}>
                Salvar
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {!feriados?.length ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Nenhum feriado cadastrado</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Fecha todas</TableHead>
                <TableHead>Recorrente</TableHead>
                <TableHead>Ativo</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {feriados.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="font-mono text-xs">
                    {new Date(f.data + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })}
                  </TableCell>
                  <TableCell className="font-medium">{f.nome}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">{f.tipo}</Badge>
                  </TableCell>
                  <TableCell>
                    {f.fecha_todas ? (
                      <Badge className="bg-destructive/10 text-destructive border-destructive/30">Sim</Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Switch checked={f.recorrente} onCheckedChange={(v) => toggle.mutate({ id: f.id, field: "recorrente", value: v })} />
                  </TableCell>
                  <TableCell>
                    <Switch checked={f.ativo} onCheckedChange={(v) => toggle.mutate({ id: f.id, field: "ativo", value: v })} />
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => remove.mutate(f.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function PoliticaPorLojaCard() {
  const qc = useQueryClient();

  const { data: lojas } = useQuery({
    queryKey: ["telefones_lojas_para_politica"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("telefones_lojas")
        .select("id, nome_loja, tipo, ativo")
        .eq("ativo", true)
        .eq("tipo", "loja")
        .order("nome_loja");
      if (error) throw error;
      return (data || []) as Loja[];
    },
  });

  const { data: politicas } = useQuery({
    queryKey: ["loja_feriado_politica"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("loja_feriado_politica")
        .select("*")
        .eq("escopo", "default_nacional");
      if (error) throw error;
      return (data || []) as Politica[];
    },
  });

  const upsert = useMutation({
    mutationFn: async ({ loja_id, politica }: { loja_id: string; politica: Politica["politica"] }) => {
      const existing = (politicas || []).find((p) => p.loja_id === loja_id && p.escopo === "default_nacional");
      if (existing) {
        const { error } = await (supabase as any)
          .from("loja_feriado_politica")
          .update({ politica, ativo: true })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any)
          .from("loja_feriado_politica")
          .insert({ loja_id, escopo: "default_nacional", politica, ativo: true });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["loja_feriado_politica"] });
      toast.success("Política atualizada");
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Store className="h-5 w-5" /> Política por Loja em Feriados Nacionais
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Define o que cada loja faz em feriados <strong>nacionais</strong>. Em <strong>01/01</strong> e <strong>01/05</strong> (fecha tudo)
          a política é ignorada — todas as lojas ficam fechadas.
        </p>
      </CardHeader>
      <CardContent>
        {!lojas?.length ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Nenhuma loja cadastrada</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Loja</TableHead>
                <TableHead>Política em feriado nacional</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lojas.map((loja) => {
                const atual = (politicas || []).find((p) => p.loja_id === loja.id && p.escopo === "default_nacional");
                return (
                  <TableRow key={loja.id}>
                    <TableCell className="font-medium">{loja.nome_loja}</TableCell>
                    <TableCell>
                      <Select
                        value={atual?.politica || "fechada"}
                        onValueChange={(v) => upsert.mutate({ loja_id: loja.id, politica: v as Politica["politica"] })}
                      >
                        <SelectTrigger className="w-[280px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(POLITICA_LABEL).map(([k, label]) => (
                            <SelectItem key={k} value={k}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
