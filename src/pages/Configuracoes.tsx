import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Plus, Building2, GitBranch, Trash2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

function useSetores() {
  return useQuery({
    queryKey: ["setores"],
    queryFn: async () => {
      const { data, error } = await supabase.from("setores").select("*").order("nome");
      if (error) throw error;
      return data;
    },
  });
}

function useFilas(setorId?: string) {
  return useQuery({
    queryKey: ["filas", setorId],
    queryFn: async () => {
      let query = supabase.from("filas").select("*, setor:setores(id, nome)").order("nome");
      if (setorId) query = query.eq("setor_id", setorId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export default function Configuracoes() {
  const [setorDialog, setSetorDialog] = useState(false);
  const [filaDialog, setFilaDialog] = useState(false);
  const queryClient = useQueryClient();
  const { data: setores } = useSetores();
  const { data: filas } = useFilas();

  const createSetor = useMutation({
    mutationFn: async (setor: { nome: string; descricao?: string }) => {
      const { error } = await supabase.from("setores").insert(setor);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setores"] });
      toast.success("Setor criado");
      setSetorDialog(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const createFila = useMutation({
    mutationFn: async (fila: { setor_id: string; nome: string; tipo: "atendimento" | "execucao"; descricao?: string; sla_minutos?: number }) => {
      const { error } = await supabase.from("filas").insert([fila]);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["filas"] });
      toast.success("Fila criada");
      setFilaDialog(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const toggleSetorAtivo = useMutation({
    mutationFn: async ({ id, ativo }: { id: string; ativo: boolean }) => {
      const { error } = await supabase.from("setores").update({ ativo }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["setores"] }),
  });

  const toggleFilaAtivo = useMutation({
    mutationFn: async ({ id, ativo }: { id: string; ativo: boolean }) => {
      const { error } = await supabase.from("filas").update({ ativo }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["filas"] }),
  });

  const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-webhook`;

  return (
    <>
      <PageHeader title="Configurações" description="Gerencie setores, filas e integrações" />

      <div className="grid gap-6">
        {/* Setores */}
        <Card className="shadow-card">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2"><Building2 className="h-5 w-5" /> Setores</CardTitle>
            <Dialog open={setorDialog} onOpenChange={setSetorDialog}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Novo Setor</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Novo Setor</DialogTitle></DialogHeader>
                <CreateSetorForm onSubmit={(data) => createSetor.mutate(data)} loading={createSetor.isPending} />
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            {!setores?.length ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Nenhum setor cadastrado</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Ativo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {setores.map((s: any) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.nome}</TableCell>
                      <TableCell className="text-muted-foreground">{s.descricao || "—"}</TableCell>
                      <TableCell>
                        <Switch checked={s.ativo} onCheckedChange={(v) => toggleSetorAtivo.mutate({ id: s.id, ativo: v })} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Filas */}
        <Card className="shadow-card">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2"><GitBranch className="h-5 w-5" /> Filas</CardTitle>
            <Dialog open={filaDialog} onOpenChange={setFilaDialog}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Nova Fila</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Nova Fila</DialogTitle></DialogHeader>
                <CreateFilaForm setores={setores || []} onSubmit={(data) => createFila.mutate(data)} loading={createFila.isPending} />
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            {!filas?.length ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Nenhuma fila cadastrada</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Setor</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>SLA</TableHead>
                    <TableHead>Ativo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filas.map((f: any) => (
                    <TableRow key={f.id}>
                      <TableCell className="font-medium">{f.nome}</TableCell>
                      <TableCell className="text-muted-foreground">{f.setor?.nome || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={f.tipo === "atendimento" ? "bg-info-soft text-info" : "bg-success-soft text-success"}>
                          {f.tipo === "atendimento" ? "Atendimento" : "Execução"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{f.sla_minutos ? `${f.sla_minutos} min` : "—"}</TableCell>
                      <TableCell>
                        <Switch checked={f.ativo} onCheckedChange={(v) => toggleFilaAtivo.mutate({ id: f.id, ativo: v })} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* WhatsApp Integration */}
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">📱 Integração WhatsApp</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-sm font-medium">URL do Webhook</Label>
              <div className="flex items-center gap-2 mt-1">
                <Input value={webhookUrl} readOnly className="font-mono text-xs" />
                <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(webhookUrl); toast.success("URL copiada!"); }}>
                  Copiar
                </Button>
              </div>
            </div>
            <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-2">
              <p className="font-medium">Como configurar:</p>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                <li>No painel do <strong>Evolution API</strong> ou <strong>Z-API</strong>, configure um novo webhook</li>
                <li>Cole a URL acima como endpoint de destino</li>
                <li>Selecione o evento <strong>messages.upsert</strong> (ou equivalente)</li>
                <li>Salve a configuração e envie uma mensagem de teste</li>
              </ol>
              <p className="text-xs text-muted-foreground mt-2">
                O sistema aceita payloads dos formatos Evolution API, Z-API e formato genérico (from/body).
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function CreateSetorForm({ onSubmit, loading }: { onSubmit: (data: { nome: string; descricao?: string }) => void; loading: boolean }) {
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ nome, descricao: descricao || undefined }); }} className="space-y-4">
      <div className="space-y-2">
        <Label>Nome *</Label>
        <Input value={nome} onChange={(e) => setNome(e.target.value)} required placeholder="Ex: Atendimento, Logística, Financeiro" />
      </div>
      <div className="space-y-2">
        <Label>Descrição</Label>
        <Textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={2} />
      </div>
      <Button type="submit" className="w-full" disabled={loading || !nome}>{loading ? "Criando..." : "Criar Setor"}</Button>
    </form>
  );
}

function CreateFilaForm({ setores, onSubmit, loading }: { setores: any[]; onSubmit: (data: any) => void; loading: boolean }) {
  const [form, setForm] = useState({ setor_id: "", nome: "", tipo: "atendimento", descricao: "", sla_minutos: "" });

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ ...form, sla_minutos: form.sla_minutos ? parseInt(form.sla_minutos) : undefined, descricao: form.descricao || undefined }); }} className="space-y-4">
      <div className="space-y-2">
        <Label>Setor *</Label>
        <Select value={form.setor_id} onValueChange={(v) => setForm({ ...form, setor_id: v })}>
          <SelectTrigger><SelectValue placeholder="Selecione o setor" /></SelectTrigger>
          <SelectContent>
            {setores.map((s: any) => (
              <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Nome *</Label>
        <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required placeholder="Ex: Fila Geral, Trocas" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Tipo</Label>
          <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="atendimento">Atendimento</SelectItem>
              <SelectItem value="execucao">Execução</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>SLA (minutos)</Label>
          <Input type="number" value={form.sla_minutos} onChange={(e) => setForm({ ...form, sla_minutos: e.target.value })} placeholder="Ex: 60" />
        </div>
      </div>
      <Button type="submit" className="w-full" disabled={loading || !form.setor_id || !form.nome}>{loading ? "Criando..." : "Criar Fila"}</Button>
    </form>
  );
}
