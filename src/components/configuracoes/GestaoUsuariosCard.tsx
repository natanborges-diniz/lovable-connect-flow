import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Users, Plus, Loader2, HelpCircle, KeyRound, Wand2, Link2, Pencil } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { DefaultUsuarioConfig } from "./DefaultUsuarioConfig";
import { BulkUserProvisioningWizard } from "./BulkUserProvisioningWizard";

// URL pública do app InFoco Messenger (mesmo backend Supabase, app distinto).
// Magic links gerados aqui devem redirecionar para esse domínio.
const INFOCO_MESSENGER_URL = "https://desktop-joy-app.lovable.app";

type AppRole = "admin" | "operador" | "setor_usuario";
type TipoUsuario = "loja" | "colaborador" | "setor_operador" | "admin";

const TIPO_USUARIO_LABELS: Record<TipoUsuario, string> = {
  loja: "Loja",
  colaborador: "Colaborador",
  setor_operador: "Op. Setor",
  admin: "Admin",
};

const TIPO_USUARIO_COLORS: Record<TipoUsuario, string> = {
  loja: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  colaborador: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  setor_operador: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  admin: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
};

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

  // Reset password dialog state
  const [resetTarget, setResetTarget] = useState<{ id: string; nome: string } | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [editTarget, setEditTarget] = useState<any>(null);

  // Create user dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [novoEmail, setNovoEmail] = useState("");
  const [novoCargo, setNovoCargo] = useState("");
  const [novoSetorId, setNovoSetorId] = useState<string>("");
  const [novoRole, setNovoRole] = useState<AppRole>("setor_usuario");
  const [novoLojaNome, setNovoLojaNome] = useState<string>("");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [bulkWizardOpen, setBulkWizardOpen] = useState(false);
  const [magicLinkDialog, setMagicLinkDialog] = useState<{ url: string; email: string } | null>(null);

  const updateTipoUsuario = useMutation({
    mutationFn: async ({ userId, tipo }: { userId: string; tipo: TipoUsuario }) => {
      const { error } = await supabase
        .from("profiles")
        .update({ tipo_usuario: tipo })
        .eq("id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Tipo atualizado");
      queryClient.invalidateQueries({ queryKey: ["admin-profiles"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Falha ao atualizar tipo"),
  });

  const createUser = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        nome: novoNome.trim(),
        email: novoEmail.trim(),
        role: novoRole,
      };
      if (novoCargo.trim()) payload.cargo = novoCargo.trim();
      if (novoSetorId) payload.setor_id = novoSetorId;
      if (novoLojaNome) payload.loja_nome = novoLojaNome;
      const { data, error } = await supabase.functions.invoke("admin-create-user", { body: payload });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as { user_id: string; email: string; invite_url?: string };
    },
    onSuccess: (data) => {
      toast.success("Usuário criado");
      setInviteUrl(data?.invite_url ?? null);
      setNovoNome("");
      setNovoEmail("");
      setNovoCargo("");
      setNovoSetorId("");
      setNovoRole("setor_usuario");
      setNovoLojaNome("");
      invalidateAll();
      queryClient.invalidateQueries({ queryKey: ["profiles-ativos"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Falha ao criar usuário"),
  });

  const resetPassword = useMutation({
    mutationFn: async ({ userId, password }: { userId: string; password: string }) => {
      const { data, error } = await supabase.functions.invoke("admin-reset-password", {
        body: { user_id: userId, new_password: password },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data;
    },
    onSuccess: () => {
      toast.success("Senha redefinida com sucesso");
      setResetTarget(null);
      setNewPassword("");
    },
    onError: (e: any) => toast.error(e.message ?? "Falha ao redefinir senha"),
  });

  const generateMagicLink = useMutation({
    mutationFn: async (email: string) => {
      // Revalida a sessão antes de chamar (evita 401 com token expirado)
      const { data: userCheck, error: userCheckErr } = await supabase.auth.getUser();
      if (userCheckErr || !userCheck?.user) {
        await supabase.auth.signOut().catch(() => {});
        throw new Error("Sua sessão expirou. Faça login novamente.");
      }
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) throw new Error("Sua sessão expirou. Faça login novamente.");
      const { data, error } = await supabase.functions.invoke("admin-magic-link", {
        body: { email, redirect_to: INFOCO_MESSENGER_URL },
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (error) {
        const msg = (error as any)?.message ?? "";
        if (msg.includes("401") || /sess[aã]o/i.test(msg)) {
          throw new Error("Sua sessão expirou. Faça login novamente.");
        }
        throw error;
      }
      if ((data as any)?.error) throw new Error((data as any).error);
      return (data as any)?.url as string;
    },
    onSuccess: (url, email) => {
      if (!url || !url.startsWith("http")) {
        toast.error("Link inválido recebido do servidor");
        console.error("[magic-link] url inválida:", url);
        return;
      }
      console.log("[magic-link] gerado:", url);
      setMagicLinkDialog({ url, email });
    },
    onError: (e: any) => toast.error(e.message ?? "Falha ao gerar link"),
  });

  // Helper de cópia com fallback execCommand (funciona em iframes sem clipboard-write)
  const copyToClipboard = async (text: string): Promise<boolean> => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // cai no fallback
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  };

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
    onSuccess: (_data, vars) => {
      invalidateAll();
      // Track intent so UI shows area picker until first area is added
      setPendingSetorIntent((prev) => {
        const next = new Set(prev);
        if (vars.newLevel === "setor_usuario") {
          next.add(vars.userId);
        } else {
          next.delete(vars.userId);
        }
        return next;
      });
      // Auto-open the area picker for setor users so they can add the first area immediately
      if (vars.newLevel === "setor_usuario") {
        setAddingAreaFor(vars.userId);
        setNewSetorId("");
        setNewLojaNome("");
      }
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
    onSuccess: (_data, vars) => {
      invalidateAll();
      setAddingAreaFor(null);
      setNewSetorId("");
      setNewLojaNome("");
      // Once first area is added, clear pending intent (real role now exists)
      setPendingSetorIntent((prev) => {
        const next = new Set(prev);
        next.delete(vars.userId);
        return next;
      });
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
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Users className="h-5 w-5" /> Gestão de Usuários e Permissões
          </CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setBulkWizardOpen(true)}>
              <Wand2 className="h-4 w-4 mr-1" /> Cadastro em lote
            </Button>
            <Button size="sm" onClick={() => { setCreateOpen(true); setInviteUrl(null); }}>
              <Plus className="h-4 w-4 mr-1" /> Novo usuário
            </Button>
          </div>
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
                  <TableHead>Tipo</TableHead>
                  <TableHead>Cargo / Setor</TableHead>
                  <TableHead>Lojas / Áreas</TableHead>
                  <TableHead>Ativo</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {profiles.map((p: any) => {
                  const tipo = (p.tipo_usuario || "setor_operador") as TipoUsuario;
                  const userRoles = getRolesForUser(p.id);
                  const setorAreas = userRoles.filter((r) => r.role === "setor_usuario" && r.setor_id);
                  const lojasArr: string[] = Array.isArray(p.lojas) ? p.lojas : [];
                  const cargoLabel = tipo === "loja"
                    ? (p.cargo_loja ? p.cargo_loja.charAt(0).toUpperCase() + p.cargo_loja.slice(1) : "—")
                    : tipo === "setor_operador"
                    ? (getSetorName(p.setor_id) || "—")
                    : tipo === "admin"
                    ? "Acesso total"
                    : "—";
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.nome}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{p.email || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] ${TIPO_USUARIO_COLORS[tipo]}`}>
                          {TIPO_USUARIO_LABELS[tipo]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{cargoLabel}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {tipo === "loja" && lojasArr.length > 0 ? (
                            lojasArr.map((l) => (
                              <Badge key={l} variant="outline" className="text-[10px]">{l}</Badge>
                            ))
                          ) : tipo === "setor_operador" && setorAreas.length > 0 ? (
                            setorAreas.map((r) => (
                              <Badge key={r.id} variant="outline" className="text-[10px]">
                                {getSetorName(r.setor_id)}
                              </Badge>
                            ))
                          ) : tipo === "admin" ? (
                            <span className="text-xs text-muted-foreground">Todas</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={p.ativo}
                          onCheckedChange={(v) => toggleAtivo.mutate({ id: p.id, ativo: v })}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                onClick={() => setEditTarget(p)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="left" className="text-xs">
                              Editar tipo, cargo, lojas e setor
                            </TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                disabled={!p.email || generateMagicLink.isPending}
                                onClick={() => p.email && generateMagicLink.mutate(p.email)}
                              >
                                {generateMagicLink.isPending && generateMagicLink.variables === p.email ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Link2 className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="left" className="text-xs">
                              Gerar link de acesso (magic link)
                            </TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                onClick={() => {
                                  setResetTarget({ id: p.id, nome: p.nome });
                                  setNewPassword("");
                                }}
                              >
                                <KeyRound className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="left" className="text-xs">
                              Redefinir senha
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Diálogo unificado de edição */}
      <EditarUsuarioDialog
        target={editTarget}
        setores={setores || []}
        lojas={lojas || []}
        onClose={() => setEditTarget(null)}
        onSaved={invalidateAll}
      />

      <Dialog open={!!resetTarget} onOpenChange={(o) => !o && setResetTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Redefinir senha</DialogTitle>
            <DialogDescription>
              Defina uma nova senha para <span className="font-medium">{resetTarget?.nome}</span>.
              Avise o usuário para trocá-la após o primeiro login.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="new-password">Nova senha</Label>
            <Input
              id="new-password"
              type="text"
              autoComplete="new-password"
              placeholder="Mínimo 6 caracteres"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setResetTarget(null)}>
              Cancelar
            </Button>
            <Button
              disabled={resetPassword.isPending || newPassword.length < 6 || !resetTarget}
              onClick={() =>
                resetTarget &&
                resetPassword.mutate({ userId: resetTarget.id, password: newPassword })
              }
            >
              {resetPassword.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Salvar nova senha"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) setInviteUrl(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Novo usuário</DialogTitle>
            <DialogDescription>
              O usuário será criado e poderá acessar o sistema via link de convite.
            </DialogDescription>
          </DialogHeader>

          {inviteUrl ? (
            <div className="space-y-2 py-2">
              <Label>Link de convite</Label>
              <div className="flex gap-2">
                <Input readOnly value={inviteUrl} onFocus={(e) => e.currentTarget.select()} />
                <Button
                  variant="outline"
                  onClick={async () => {
                    const ok = await copyToClipboard(inviteUrl);
                    if (ok) toast.success("Link copiado!");
                    else toast.error("Não consegui copiar — selecione e copie manualmente.");
                  }}
                >
                  Copiar
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Envie este link para o usuário definir a senha e acessar o sistema.
              </p>
            </div>
          ) : (
            <div className="space-y-3 py-2">
              <div className="space-y-1">
                <Label htmlFor="novo-nome">Nome</Label>
                <Input id="novo-nome" value={novoNome} onChange={(e) => setNovoNome(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="novo-email">E-mail</Label>
                <Input id="novo-email" type="email" value={novoEmail} onChange={(e) => setNovoEmail(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="novo-cargo">Cargo (opcional)</Label>
                <Input id="novo-cargo" value={novoCargo} onChange={(e) => setNovoCargo(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Nível de acesso</Label>
                <Select value={novoRole} onValueChange={(v) => setNovoRole(v as AppRole)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="operador">Operador</SelectItem>
                    <SelectItem value="setor_usuario">Setor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {novoRole === "setor_usuario" && (
                <>
                  <div className="space-y-1">
                    <Label>Setor</Label>
                    <Select value={novoSetorId} onValueChange={(v) => { setNovoSetorId(v); setNovoLojaNome(""); }}>
                      <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        {setores?.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {isLojaSetor(novoSetorId) && (
                    <div className="space-y-1">
                      <Label>Loja</Label>
                      <Select value={novoLojaNome} onValueChange={setNovoLojaNome}>
                        <SelectTrigger><SelectValue placeholder="Selecione a loja" /></SelectTrigger>
                        <SelectContent>
                          {lojas?.map((l) => (
                            <SelectItem key={l} value={l}>{l}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <DialogFooter>
            {inviteUrl ? (
              <Button onClick={() => { setCreateOpen(false); setInviteUrl(null); }}>Fechar</Button>
            ) : (
              <>
                <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancelar</Button>
                <Button
                  disabled={
                    createUser.isPending ||
                    novoNome.trim().length < 2 ||
                    !novoEmail.includes("@") ||
                    (novoRole === "setor_usuario" && !novoSetorId) ||
                    (novoRole === "setor_usuario" && isLojaSetor(novoSetorId) && !novoLojaNome)
                  }
                  onClick={() => createUser.mutate()}
                >
                  {createUser.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Criar usuário"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BulkUserProvisioningWizard
        open={bulkWizardOpen}
        onOpenChange={setBulkWizardOpen}
        onComplete={invalidateAll}
      />

      {/* Diálogo do magic link — funciona mesmo quando clipboard automático é bloqueado pelo iframe */}
      <Dialog
        open={!!magicLinkDialog}
        onOpenChange={(o) => { if (!o) setMagicLinkDialog(null); }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Link de acesso — InFoco Messenger</DialogTitle>
            <DialogDescription>
              {magicLinkDialog?.email
                ? `Envie este link para ${magicLinkDialog.email}. Válido por 1 hora, uso único.`
                : "Link válido por 1 hora, uso único."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-2">
            <Label>URL</Label>
            <Input
              readOnly
              value={magicLinkDialog?.url ?? ""}
              onFocus={(e) => e.currentTarget.select()}
              autoFocus
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              Selecione o texto e copie manualmente caso o botão "Copiar" não funcione no seu navegador.
            </p>
          </div>

          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              onClick={async () => {
                if (!magicLinkDialog) return;
                const ok = await copyToClipboard(magicLinkDialog.url);
                if (ok) toast.success("Link copiado!");
                else toast.error("Não consegui copiar — selecione e copie manualmente.");
              }}
            >
              Copiar link
            </Button>
            <Button
              onClick={() => {
                if (!magicLinkDialog) return;
                window.open(magicLinkDialog.url, "_blank", "noopener,noreferrer");
              }}
            >
              Abrir no Messenger
            </Button>
            <Button variant="ghost" onClick={() => setMagicLinkDialog(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </TooltipProvider>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Diálogo unificado: tipo + cargo + lojas + setor numa única tela
// ─────────────────────────────────────────────────────────────────────────
interface EditarUsuarioDialogProps {
  target: any | null;
  setores: Array<{ id: string; nome: string }>;
  lojas: string[];
  onClose: () => void;
  onSaved: () => void;
}

function EditarUsuarioDialog({ target, setores, lojas, onClose, onSaved }: EditarUsuarioDialogProps) {
  const open = !!target;
  const [tipo, setTipo] = useState<TipoUsuario>("setor_operador");
  const [cargoLoja, setCargoLoja] = useState<"supervisor" | "gerente" | "operador">("operador");
  const [lojasSelected, setLojasSelected] = useState<string[]>([]);
  const [lojasResponsaveis, setLojasResponsaveis] = useState<string[]>([]);
  const [setorId, setSetorId] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!target) return;
    setTipo(((target.tipo_usuario as TipoUsuario) || "setor_operador"));
    setCargoLoja((target.cargo_loja as any) || "operador");
    setLojasSelected(Array.isArray(target.lojas) ? target.lojas : []);
    setLojasResponsaveis(Array.isArray(target.lojas_responsaveis) ? target.lojas_responsaveis : []);
    setSetorId(target.setor_id || "");
  }, [target?.id]);

  const onOpenChange = (o: boolean) => { if (!o) onClose(); };

  const handleSave = async () => {
    if (!target) return;
    setSaving(true);
    try {
      const update: any = { tipo_usuario: tipo };
      if (tipo === "loja") {
        update.cargo_loja = cargoLoja;
        update.lojas = lojasSelected;
        update.lojas_responsaveis = cargoLoja === "operador" ? [] : lojasResponsaveis;
        update.setor_id = null;
      } else if (tipo === "setor_operador") {
        update.cargo_loja = null;
        update.lojas = [];
        update.lojas_responsaveis = [];
        update.setor_id = setorId || null;
      } else {
        update.cargo_loja = null;
        update.lojas = [];
        update.lojas_responsaveis = [];
        update.setor_id = null;
      }
      const { error } = await supabase.from("profiles").update(update).eq("id", target.id);
      if (error) throw error;
      toast.success("Usuário atualizado");
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e.message ?? "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  };


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {target && (
          <EditarUsuarioForm
            key={target.id}
            target={target}
            setores={setores}
            lojas={lojas}
            tipo={tipo}
            setTipo={setTipo}
            cargoLoja={cargoLoja}
            setCargoLoja={setCargoLoja}
            lojasSelected={lojasSelected}
            setLojasSelected={setLojasSelected}
            lojasResponsaveis={lojasResponsaveis}
            setLojasResponsaveis={setLojasResponsaveis}
            setorId={setorId}
            setSetorId={setSetorId}
            saving={saving}
            onCancel={onClose}
            onSave={handleSave}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}


interface EditarUsuarioFormProps {
  target: any;
  setores: Array<{ id: string; nome: string }>;
  lojas: string[];
  tipo: TipoUsuario;
  setTipo: (t: TipoUsuario) => void;
  cargoLoja: "supervisor" | "gerente" | "operador";
  setCargoLoja: (c: "supervisor" | "gerente" | "operador") => void;
  lojasSelected: string[];
  setLojasSelected: (l: string[]) => void;
  setorId: string;
  setSetorId: (id: string) => void;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}

function EditarUsuarioForm(props: EditarUsuarioFormProps) {
  const { target, setores, lojas, tipo, setTipo, cargoLoja, setCargoLoja,
    lojasSelected, setLojasSelected, setorId, setSetorId, saving, onCancel, onSave } = props;

  // (Hidratação acontece no Dialog pai via useEffect)

  const toggleLoja = (loja: string) => {
    if (lojasSelected.includes(loja)) {
      setLojasSelected(lojasSelected.filter((l) => l !== loja));
    } else {
      setLojasSelected([...lojasSelected, loja]);
    }
  };

  const canSave =
    (tipo === "admin" || tipo === "colaborador") ||
    (tipo === "loja" && lojasSelected.length > 0) ||
    (tipo === "setor_operador" && !!setorId);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Editar usuário — {target.nome}</DialogTitle>
        <DialogDescription>
          Defina o tipo, cargo e lojas/setor. As áreas de acesso são sincronizadas automaticamente.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-5 py-2">
        {/* Tipo */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Tipo de usuário</Label>
          <div className="grid grid-cols-2 gap-2">
            {(["loja", "setor_operador", "colaborador", "admin"] as TipoUsuario[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTipo(t)}
                className={`text-left rounded-md border px-3 py-2 text-sm transition-colors ${
                  tipo === t ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"
                }`}
              >
                <div className="font-medium">{TIPO_USUARIO_LABELS[t]}</div>
                <div className="text-[11px] text-muted-foreground">
                  {t === "loja" && "Equipe de loja — só InFoco Messenger"}
                  {t === "setor_operador" && "Operador de setor — Atrium web"}
                  {t === "colaborador" && "Colaborador interno geral"}
                  {t === "admin" && "Acesso total ao sistema"}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Quando tipo = loja */}
        {tipo === "loja" && (
          <>
            <div className="space-y-2">
              <Label className="text-sm font-medium">Cargo na loja</Label>
              <div className="grid grid-cols-3 gap-2">
                {(["supervisor", "gerente", "operador"] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCargoLoja(c)}
                    className={`rounded-md border px-3 py-2 text-sm capitalize transition-colors ${
                      cargoLoja === c ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Cargo controla quais opções aparecem no menu de demandas do Messenger.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">
                Lojas que atende ({lojasSelected.length} selecionada{lojasSelected.length === 1 ? "" : "s"})
              </Label>
              <div className="max-h-56 overflow-auto rounded-md border p-2 grid grid-cols-2 gap-1">
                {lojas.length === 0 ? (
                  <p className="text-xs text-muted-foreground p-2">Nenhuma loja cadastrada.</p>
                ) : (
                  lojas.map((l) => (
                    <label key={l} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted/40 cursor-pointer">
                      <Checkbox
                        checked={lojasSelected.includes(l)}
                        onCheckedChange={() => toggleLoja(l)}
                      />
                      <span className="text-sm">{l}</span>
                    </label>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
              🔒 Acesso ao Atrium web: <strong>bloqueado</strong>. Usuário só usa o InFoco Messenger.
            </div>
          </>
        )}

        {/* Quando tipo = setor_operador */}
        {tipo === "setor_operador" && (
          <div className="space-y-2">
            <Label className="text-sm font-medium">Setor</Label>
            <Select value={setorId} onValueChange={setSetorId}>
              <SelectTrigger><SelectValue placeholder="Selecione o setor" /></SelectTrigger>
              <SelectContent>
                {setores.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {tipo === "admin" && (
          <div className="rounded-md bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-amber-900 dark:text-amber-200">
            Acesso administrativo total ao Atrium e todos os setores.
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button disabled={saving || !canSave} onClick={onSave}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
        </Button>
      </DialogFooter>
    </>
  );
}

