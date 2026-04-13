import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Users, Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { DefaultUsuarioConfig } from "./DefaultUsuarioConfig";

type AppRole = "admin" | "operador" | "setor_usuario";

function useLojas() {
  return useQuery({
    queryKey: ["telefones-lojas-nomes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("telefones_lojas")
        .select("nome_loja")
        .eq("tipo", "loja")
        .eq("ativo", true);
      if (error) throw error;
      const unique = [...new Set((data || []).map((d) => d.nome_loja))].sort();
      return unique;
    },
  });
}

function useProfiles() {
  return useQuery({
    queryKey: ["admin-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .order("nome");
      if (error) throw error;
      return data;
    },
  });
}

function useAllRoles() {
  return useQuery({
    queryKey: ["admin-user-roles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("*");
      if (error) throw error;
      return data as Array<{ id: string; user_id: string; role: AppRole; setor_id: string | null; loja_nome: string | null }>;
    },
  });
}

function useSetores() {
  return useQuery({
    queryKey: ["setores"],
    queryFn: async () => {
      const { data, error } = await supabase.from("setores").select("*").eq("ativo", true).order("nome");
      if (error) throw error;
      return data;
    },
  });
}

export function GestaoUsuariosCard() {
  const { data: profiles, isLoading: loadingProfiles } = useProfiles();
  const { data: allRoles, isLoading: loadingRoles } = useAllRoles();
  const { data: setores } = useSetores();
  const { data: lojas } = useLojas();
  const queryClient = useQueryClient();

  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [newRole, setNewRole] = useState<AppRole>("setor_usuario");
  const [newSetorId, setNewSetorId] = useState("");
  const [newLojaNome, setNewLojaNome] = useState("");

  const lojaSetorId = setores?.find((s) => s.nome.toLowerCase() === "loja")?.id;
  const isLojaSetor = (id: string | null) => id != null && id === lojaSetorId;

  const addRole = useMutation({
    mutationFn: async ({ userId, role, setorId, lojaNome }: { userId: string; role: AppRole; setorId?: string; lojaNome?: string }) => {
      const { error } = await (supabase as any)
        .from("user_roles")
        .insert({ user_id: userId, role, setor_id: setorId || null, loja_nome: lojaNome || null });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-user-roles"] });
      setAddingFor(null);
      setNewRole("setor_usuario");
      setNewSetorId("");
      setNewLojaNome("");
      toast.success("Permissão adicionada");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const removeRole = useMutation({
    mutationFn: async (roleId: string) => {
      const { error } = await supabase.from("user_roles").delete().eq("id", roleId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-user-roles"] });
      toast.success("Permissão removida");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleAtivo = useMutation({
    mutationFn: async ({ id, ativo }: { id: string; ativo: boolean }) => {
      const { error } = await supabase.from("profiles").update({ ativo }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-profiles"] }),
  });

  const updateProfileSetor = useMutation({
    mutationFn: async ({ id, setor_id }: { id: string; setor_id: string | null }) => {
      const { error } = await supabase.from("profiles").update({ setor_id }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-profiles"] });
      toast.success("Setor atualizado");
    },
  });

  const getRolesForUser = (userId: string) =>
    allRoles?.filter((r) => r.user_id === userId) || [];

  const getSetorName = (setorId: string | null) => {
    if (!setorId) return null;
    return setores?.find((s) => s.id === setorId)?.nome || "—";
  };

  const roleLabel = (role: AppRole) => {
    switch (role) {
      case "admin": return "Admin";
      case "operador": return "Operador";
      case "setor_usuario": return "Setor";
    }
  };

  const roleBadgeVariant = (role: AppRole) => {
    switch (role) {
      case "admin": return "default";
      case "operador": return "secondary";
      case "setor_usuario": return "outline";
    }
  };

  if (loadingProfiles || loadingRoles) {
    return (
      <Card className="shadow-card">
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Users className="h-5 w-5" /> Gestão de Usuários e Permissões
        </CardTitle>
      </CardHeader>
      <CardContent>
        <DefaultUsuarioConfig />
        {!profiles?.length ? (
          <p className="text-sm text-muted-foreground text-center py-4">Nenhum usuário cadastrado</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead>Setor Principal</TableHead>
                <TableHead>Permissões</TableHead>
                <TableHead>Ativo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profiles.map((p) => {
                const userRoles = getRolesForUser(p.id);
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.nome}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{p.email || "—"}</TableCell>
                    <TableCell>
                      <Select
                        value={p.setor_id || "none"}
                        onValueChange={(v) => updateProfileSetor.mutate({ id: p.id, setor_id: v === "none" ? null : v })}
                      >
                        <SelectTrigger className="h-8 w-36 text-xs">
                          <SelectValue placeholder="Sem setor" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Sem setor</SelectItem>
                          {setores?.map((s) => (
                            <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {userRoles.map((r) => (
                          <Badge key={r.id} variant={roleBadgeVariant(r.role) as any} className="text-[10px] gap-1">
                            {roleLabel(r.role)}
                            {r.setor_id && <span className="opacity-70">({getSetorName(r.setor_id)})</span>}
                            <button
                              onClick={() => removeRole.mutate(r.id)}
                              className="ml-0.5 hover:text-destructive"
                              title="Remover permissão"
                            >
                              ×
                            </button>
                          </Badge>
                        ))}
                        {addingFor === p.id ? (
                          <div className="flex items-center gap-1">
                            <Select value={newRole} onValueChange={(v) => setNewRole(v as AppRole)}>
                              <SelectTrigger className="h-6 w-24 text-[10px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="admin">Admin</SelectItem>
                                <SelectItem value="operador">Operador</SelectItem>
                                <SelectItem value="setor_usuario">Setor</SelectItem>
                              </SelectContent>
                            </Select>
                            {newRole === "setor_usuario" && (
                              <Select value={newSetorId} onValueChange={setNewSetorId}>
                                <SelectTrigger className="h-6 w-28 text-[10px]">
                                  <SelectValue placeholder="Setor" />
                                </SelectTrigger>
                                <SelectContent>
                                  {setores?.map((s) => (
                                    <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                            <Button
                              size="sm"
                              className="h-6 px-2 text-[10px]"
                              onClick={() => addRole.mutate({
                                userId: p.id,
                                role: newRole,
                                setorId: newRole === "setor_usuario" ? newSetorId : undefined,
                              })}
                              disabled={addRole.isPending || (newRole === "setor_usuario" && !newSetorId)}
                            >
                              OK
                            </Button>
                            <Button size="sm" variant="ghost" className="h-6 px-1" onClick={() => setAddingFor(null)}>✕</Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-5 w-5 p-0"
                            onClick={() => setAddingFor(p.id)}
                            title="Adicionar permissão"
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={p.ativo}
                        onCheckedChange={(v) => toggleAtivo.mutate({ id: p.id, ativo: v })}
                      />
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
