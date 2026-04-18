import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Plus, Phone, Trash2, Pencil, ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type TipoCorporativo = "loja" | "colaborador" | "departamento";

interface LojaFormData {
  telefone: string;
  nome_loja: string;
  tipo: TipoCorporativo;
  cod_empresa?: string;
  departamento?: string;
  endereco?: string;
  horario_abertura?: string;
  horario_fechamento?: string;
  google_profile_url?: string;
  cargo?: string;
  nome_colaborador?: string;
  setor_destino_id?: string | null;
}

const TIPO_LABELS: Record<TipoCorporativo, string> = {
  loja: "Loja",
  colaborador: "Colaborador",
  departamento: "Departamento",
};

const TIPO_COLORS: Record<TipoCorporativo, string> = {
  loja: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  colaborador: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  departamento: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
};

export function TelefonesLojasCard() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingLoja, setEditingLoja] = useState<any>(null);
  const [filtroTipo, setFiltroTipo] = useState<string>("todos");
  const queryClient = useQueryClient();

  const { data: telefones, isLoading } = useQuery({
    queryKey: ["telefones_lojas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("telefones_lojas")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const filtered = telefones?.filter((t: any) =>
    filtroTipo === "todos" ? true : (t.tipo || "loja") === filtroTipo
  );

  const toggleAtivo = useMutation({
    mutationFn: async ({ id, ativo }: { id: string; ativo: boolean }) => {
      const { error } = await supabase.from("telefones_lojas").update({ ativo }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["telefones_lojas"] }),
  });

  const deleteTelefone = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("telefones_lojas").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["telefones_lojas"] }); toast.success("Telefone removido"); },
    onError: (e: any) => toast.error(e.message),
  });

  const createTelefone = useMutation({
    mutationFn: async (data: LojaFormData) => {
      const { error } = await supabase.from("telefones_lojas").insert({
        telefone: data.telefone,
        nome_loja: data.nome_loja,
        tipo: data.tipo,
        cod_empresa: data.cod_empresa,
        departamento: data.departamento,
        endereco: data.endereco,
        horario_abertura: data.horario_abertura,
        horario_fechamento: data.horario_fechamento,
        google_profile_url: data.google_profile_url,
        cargo: data.cargo,
        nome_colaborador: data.nome_colaborador,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["telefones_lojas"] }); toast.success("Telefone cadastrado"); setCreateDialogOpen(false); },
    onError: (e: any) => toast.error(e.message),
  });

  const updateTelefone = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: LojaFormData }) => {
      const { error } = await supabase.from("telefones_lojas").update({
        telefone: data.telefone,
        nome_loja: data.nome_loja,
        tipo: data.tipo,
        cod_empresa: data.cod_empresa,
        departamento: data.departamento,
        endereco: data.endereco,
        horario_abertura: data.horario_abertura,
        horario_fechamento: data.horario_fechamento,
        google_profile_url: data.google_profile_url,
        cargo: data.cargo,
        nome_colaborador: data.nome_colaborador,
      } as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["telefones_lojas"] }); toast.success("Atualizado"); setEditDialogOpen(false); setEditingLoja(null); },
    onError: (e: any) => toast.error(e.message),
  });

  const handleEdit = (loja: any) => { setEditingLoja(loja); setEditDialogOpen(true); };

  const getDisplayName = (t: any) => {
    const tipo = t.tipo || "loja";
    if (tipo === "colaborador") return t.nome_colaborador || t.nome_loja;
    return t.nome_loja;
  };

  const getSubInfo = (t: any) => {
    const tipo = t.tipo || "loja";
    if (tipo === "colaborador") return t.cargo || "—";
    if (tipo === "departamento") return t.departamento || "—";
    return t.endereco || "—";
  };

  return (
    <Card className="shadow-card">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg flex items-center gap-2">
          <Phone className="h-5 w-5" /> Telefones Corporativos
        </CardTitle>
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Novo Cadastro</Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Cadastrar Telefone Corporativo</DialogTitle></DialogHeader>
            <LojaForm onSubmit={(data) => createTelefone.mutate(data)} loading={createTelefone.isPending} submitLabel="Cadastrar" />
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4">
          Telefones cadastrados são identificados automaticamente e direcionados ao bot de autoatendimento com menu específico por tipo.
        </p>

        <Tabs value={filtroTipo} onValueChange={setFiltroTipo} className="mb-4">
          <TabsList>
            <TabsTrigger value="todos">Todos</TabsTrigger>
            <TabsTrigger value="loja">Lojas</TabsTrigger>
            <TabsTrigger value="colaborador">Colaboradores</TabsTrigger>
            <TabsTrigger value="departamento">Departamentos</TabsTrigger>
          </TabsList>
        </Tabs>

        {isLoading ? (
          <p className="text-sm text-muted-foreground text-center py-4">Carregando...</p>
        ) : !filtered?.length ? (
          <p className="text-sm text-muted-foreground text-center py-4">Nenhum telefone cadastrado</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Info</TableHead>
                <TableHead>Ativo</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((t: any) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <Badge variant="outline" className={TIPO_COLORS[t.tipo as TipoCorporativo || "loja"]}>
                      {TIPO_LABELS[t.tipo as TipoCorporativo || "loja"]}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{t.telefone}</TableCell>
                  <TableCell className="font-medium">{getDisplayName(t)}</TableCell>
                  <TableCell className="text-muted-foreground text-xs max-w-[200px] truncate">{getSubInfo(t)}</TableCell>
                  <TableCell>
                    <Switch checked={t.ativo ?? true} onCheckedChange={(v) => toggleAtivo.mutate({ id: t.id, ativo: v })} />
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEdit(t)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteTelefone.mutate(t.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={editDialogOpen} onOpenChange={(open) => { setEditDialogOpen(open); if (!open) setEditingLoja(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Editar Cadastro</DialogTitle></DialogHeader>
          {editingLoja && (
            <LojaForm
              initialData={{
                telefone: editingLoja.telefone,
                nome_loja: editingLoja.nome_loja,
                tipo: editingLoja.tipo || "loja",
                cod_empresa: editingLoja.cod_empresa || "",
                departamento: editingLoja.departamento || "geral",
                endereco: editingLoja.endereco || "",
                horario_abertura: editingLoja.horario_abertura || "09:00",
                horario_fechamento: editingLoja.horario_fechamento || "18:00",
                google_profile_url: editingLoja.google_profile_url || "",
                cargo: editingLoja.cargo || "",
                nome_colaborador: editingLoja.nome_colaborador || "",
              }}
              onSubmit={(data) => updateTelefone.mutate({ id: editingLoja.id, data })}
              loading={updateTelefone.isPending}
              submitLabel="Salvar Alterações"
            />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function LojaForm({
  onSubmit, loading, submitLabel, initialData,
}: {
  onSubmit: (data: LojaFormData) => void;
  loading: boolean;
  submitLabel: string;
  initialData?: Partial<LojaFormData> & { telefone: string; nome_loja: string };
}) {
  const [form, setForm] = useState({
    telefone: initialData?.telefone || "",
    nome_loja: initialData?.nome_loja || "",
    tipo: (initialData?.tipo || "loja") as TipoCorporativo,
    cod_empresa: initialData?.cod_empresa || "",
    departamento: initialData?.departamento || "geral",
    endereco: initialData?.endereco || "",
    horario_abertura: initialData?.horario_abertura || "09:00",
    horario_fechamento: initialData?.horario_fechamento || "18:00",
    google_profile_url: initialData?.google_profile_url || "",
    cargo: initialData?.cargo || "",
    nome_colaborador: initialData?.nome_colaborador || "",
  });

  const isNameValid = form.tipo === "colaborador" ? !!form.nome_colaborador : !!form.nome_loja;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          telefone: form.telefone.replace(/\D/g, ""),
          nome_loja: form.tipo === "colaborador" ? (form.nome_colaborador || form.nome_loja) : form.nome_loja,
          tipo: form.tipo,
          cod_empresa: form.cod_empresa || undefined,
          departamento: form.departamento || "geral",
          endereco: form.endereco || undefined,
          horario_abertura: form.horario_abertura || "09:00",
          horario_fechamento: form.horario_fechamento || "18:00",
          google_profile_url: form.google_profile_url || undefined,
          cargo: form.cargo || undefined,
          nome_colaborador: form.nome_colaborador || undefined,
        });
      }}
      className="space-y-4"
    >
      <div className="space-y-2">
        <Label>Tipo *</Label>
        <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v as TipoCorporativo })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="loja">Loja</SelectItem>
            <SelectItem value="colaborador">Colaborador</SelectItem>
            <SelectItem value="departamento">Departamento</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Telefone *</Label>
        <Input value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} placeholder="5511999999999" className="font-mono" required />
      </div>

      {form.tipo === "colaborador" && (
        <>
          <div className="space-y-2">
            <Label>Nome do Colaborador *</Label>
            <Input value={form.nome_colaborador} onChange={(e) => setForm({ ...form, nome_colaborador: e.target.value })} placeholder="Ex: João Silva" required />
          </div>
          <div className="space-y-2">
            <Label>Cargo</Label>
            <Input value={form.cargo} onChange={(e) => setForm({ ...form, cargo: e.target.value })} placeholder="Ex: Gerente, Vendedor" />
          </div>
        </>
      )}

      {form.tipo === "departamento" && (
        <div className="space-y-2">
          <Label>Nome do Departamento *</Label>
          <Input value={form.nome_loja} onChange={(e) => setForm({ ...form, nome_loja: e.target.value })} placeholder="Ex: Financeiro, TI" required />
        </div>
      )}

      {form.tipo === "loja" && (
        <>
          <div className="space-y-2">
            <Label>Nome da Loja *</Label>
            <Input value={form.nome_loja} onChange={(e) => setForm({ ...form, nome_loja: e.target.value })} placeholder="Ex: Ótica Centro" required />
          </div>
          <div className="space-y-2">
            <Label>Endereço</Label>
            <Input value={form.endereco} onChange={(e) => setForm({ ...form, endereco: e.target.value })} placeholder="Ex: Av. Autonomistas, 1768" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Horário Abertura</Label>
              <Input type="time" value={form.horario_abertura} onChange={(e) => setForm({ ...form, horario_abertura: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Horário Fechamento</Label>
              <Input type="time" value={form.horario_fechamento} onChange={(e) => setForm({ ...form, horario_fechamento: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Cód. Empresa</Label>
              <Input value={form.cod_empresa} onChange={(e) => setForm({ ...form, cod_empresa: e.target.value })} placeholder="Ex: 001" />
            </div>
            <div className="space-y-2">
              <Label>Departamento</Label>
              <Input value={form.departamento} onChange={(e) => setForm({ ...form, departamento: e.target.value })} placeholder="geral" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Link Perfil Google</Label>
            <Input value={form.google_profile_url} onChange={(e) => setForm({ ...form, google_profile_url: e.target.value })} placeholder="https://maps.app.goo.gl/..." type="url" />
            <p className="text-xs text-muted-foreground">URL do perfil no Google Maps/Business da loja</p>
          </div>
        </>
      )}

      <Button type="submit" className="w-full" disabled={loading || !form.telefone || !isNameValid}>
        {loading ? "Salvando..." : submitLabel}
      </Button>
    </form>
  );
}
