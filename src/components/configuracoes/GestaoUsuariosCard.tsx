import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Users, Plus, Loader2, HelpCircle } from "lucide-react";
import { toast } from "sonner";
import { DefaultUsuarioConfig } from "./DefaultUsuarioConfig";

type AppRole = "admin" | "operador" | "setor_usuario";

interface UserRoleRow {
  id: string;
  user_id: string;
  role: AppRole;
  setor_id: string | null;
  loja_nome: string | null;
}

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
      return [...new Set((data || []).map((d) => d.nome_loja))].sort();
    },
  });
}

function useProfiles() {
  return useQuery({
    queryKey: ["admin-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*").order("nome");
      if (error) throw error;
      return data;
    },
  });
}

function useAllRoles() {
  return useQuery({
    queryKey: ["admin-user-roles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("user_roles").select("*");
      if (error) throw error;
      return data as UserRoleRow[];
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

function getUserAccessLevel(roles: UserRoleRow[]): AppRole | null {
  if (roles.some((r) => r.role === "admin")) return "admin";
  if (roles.some((r) => r.role === "operador")) return "operador";
  if (roles.some((r) => r.role === "setor_usuario")) return "setor_usuario";
  return null;
}

export function GestaoUsuariosCard() {
  const { data: profiles, isLoading: loadingProfiles } = useProfiles();
  const { data: allRoles, isLoading: loadingRoles } = useAllRoles();
  const { data: setores } = useSetores();
  const { data: lojas } = useLojas();
  const queryClient = useQueryClient();

  const [addingAreaFor, setAddingAreaFor] = useState<string | null>(null);
  const [newSetorId, setNewSetorId] = useState("");
  const [newLojaNome, setNewLojaNome] = useState("");
  // Pending "setor" intent: user picked Setor in dropdown but hasn't added any area yet.
  // Without this, currentLevel falls back to null and the Áreas column hides the picker.
  const [pendingSetorIntent, setPendingSetorIntent] = useState<Set<string>>(new Set());

  const lojaSetorId = setores?.find((s) => s.nome.toLowerCase() === "loja")?.id;
  const isLojaSetor = (id: string | null) => id != null && id === lojaSetorId;

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-user-roles"] });
    queryClient.invalidateQueries({ queryKey: ["admin-profiles"] });
  };

  const syncProfileSetor = async (userId: string, roles: UserRoleRow[]) => {
    const setorRoles = roles.filter((r) => r.setor_id);
    const firstSetorId = setorRoles.length > 0 ? setorRoles[0].setor_id : null;
    await supabase.from("profiles").update({ setor_id: firstSetorId }).eq("id", userId);
  };

  // Change access level: delete all existing roles, insert new one
  const changeAccessLevel = useMutation({
    mutationFn: async ({ userId, newLevel }: { userId: string; newLevel: AppRole }) => {
      // Delete all existing roles
      const { error: delErr } = await supabase.from("user_roles").delete().eq("user_id", userId);
      if (delErr) throw delErr;

      if (newLevel === "admin" || newLevel === "operador") {
        const { error } = await (supabase as any)
          .from("user_roles")
          .insert({ user_id: userId, role: newLevel });
        if (error) throw error;
        // Clear profile setor
        await supabase.from("profiles").update({ setor_id: null }).eq("id", userId);
      }
      // For setor_usuario, no role inserted yet — user must add areas
    },
    onSuccess: () => {
      invalidateAll();
      toast.success("Nível de acesso atualizado");
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Add a setor area (setor_usuario role record)
  const addArea = useMutation({
    mutationFn: async ({ userId, setorId, lojaNome }: { userId: string; setorId: string; lojaNome?: string }) => {
      const { error } = await (supabase as any)
        .from("user_roles")
        .insert({ user_id: userId, role: "setor_usuario", setor_id: setorId, loja_nome: lojaNome || null });
      if (error) throw error;
      // Sync profile setor
      const { data: updatedRoles } = await supabase.from("user_roles").select("*").eq("user_id", userId);
      if (updatedRoles) await syncProfileSetor(userId, updatedRoles as UserRoleRow[]);
    },
    onSuccess: () => {
      invalidateAll();
      setAddingAreaFor(null);
      setNewSetorId("");
      setNewLojaNome("");
      toast.success("Área adicionada");
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Remove a setor area
  const removeArea = useMutation({
    mutationFn: async ({ roleId, userId }: { roleId: string; userId: string }) => {
      const { error } = await supabase.from("user_roles").delete().eq("id", roleId);
      if (error) throw error;
      const { data: updatedRoles } = await supabase.from("user_roles").select("*").eq("user_id", userId);
      if (updatedRoles) await syncProfileSetor(userId, updatedRoles as UserRoleRow[]);
    },
    onSuccess: () => {
      invalidateAll();
      toast.success("Área removida");
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

  const getRolesForUser = (userId: string) => allRoles?.filter((r) => r.user_id === userId) || [];

  const getSetorName = (setorId: string | null) => {
    if (!setorId) return null;
    return setores?.find((s) => s.id === setorId)?.nome || "—";
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
    <TooltipProvider>
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
                  <TableHead>
                    <div className="flex items-center gap-1">
                      Nível de Acesso
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-[220px] text-xs">
                          Define o que o usuário pode fazer no sistema
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center gap-1">
                      Áreas do Sistema
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-[220px] text-xs">
                          Define quais módulos o usuário pode ver (apenas para nível Setor)
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </TableHead>
                  <TableHead>Ativo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {profiles.map((p) => {
                  const userRoles = getRolesForUser(p.id);
                  const currentLevel = getUserAccessLevel(userRoles);
                  const setorAreas = userRoles.filter((r) => r.role === "setor_usuario" && r.setor_id);

                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.nome}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{p.email || "—"}</TableCell>

                      {/* Nível de Acesso */}
                      <TableCell>
                        <Select
                          value={currentLevel || "none"}
                          onValueChange={(v) => {
                            if (v === "none") return;
                            changeAccessLevel.mutate({ userId: p.id, newLevel: v as AppRole });
                          }}
                        >
                          <SelectTrigger className="h-8 w-32 text-xs">
                            <SelectValue placeholder="Sem acesso" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none" disabled>Sem acesso</SelectItem>
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="operador">Operador</SelectItem>
                            <SelectItem value="setor_usuario">Setor</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>

                      {/* Áreas do Sistema */}
                      <TableCell>
                        {currentLevel === "setor_usuario" ? (
                          <div className="flex flex-wrap gap-1 items-center">
                            {setorAreas.map((r) => (
                              <Badge key={r.id} variant="outline" className="text-[10px] gap-1">
                                {getSetorName(r.setor_id)}
                                {r.loja_nome && <span className="opacity-70">· {r.loja_nome}</span>}
                                <button
                                  onClick={() => removeArea.mutate({ roleId: r.id, userId: p.id })}
                                  className="ml-0.5 hover:text-destructive"
                                  title="Remover área"
                                >
                                  ×
                                </button>
                              </Badge>
                            ))}

                            {addingAreaFor === p.id ? (
                              <div className="flex items-center gap-1">
                                <Select value={newSetorId} onValueChange={(v) => { setNewSetorId(v); setNewLojaNome(""); }}>
                                  <SelectTrigger className="h-6 w-28 text-[10px]">
                                    <SelectValue placeholder="Setor" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {setores?.map((s) => (
                                      <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>

                                {isLojaSetor(newSetorId) && (
                                  <Select value={newLojaNome} onValueChange={setNewLojaNome}>
                                    <SelectTrigger className="h-6 w-36 text-[10px]">
                                      <SelectValue placeholder="Selecione a loja" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {lojas?.map((l) => (
                                        <SelectItem key={l} value={l}>{l}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                )}

                                <Button
                                  size="sm"
                                  className="h-6 px-2 text-[10px]"
                                  onClick={() => addArea.mutate({
                                    userId: p.id,
                                    setorId: newSetorId,
                                    lojaNome: isLojaSetor(newSetorId) ? newLojaNome : undefined,
                                  })}
                                  disabled={addArea.isPending || !newSetorId || (isLojaSetor(newSetorId) && !newLojaNome)}
                                >
                                  OK
                                </Button>
                                <Button size="sm" variant="ghost" className="h-6 px-1" onClick={() => setAddingAreaFor(null)}>✕</Button>
                              </div>
                            ) : (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-5 w-5 p-0"
                                onClick={() => setAddingAreaFor(p.id)}
                                title="Adicionar área"
                              >
                                <Plus className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        ) : currentLevel === "admin" ? (
                          <span className="text-xs text-muted-foreground">Acesso total</span>
                        ) : currentLevel === "operador" ? (
                          <span className="text-xs text-muted-foreground">Todas as áreas (leitura)</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
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
    </TooltipProvider>
  );
}
