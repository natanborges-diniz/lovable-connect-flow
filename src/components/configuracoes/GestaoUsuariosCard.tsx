import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
import { Users, Plus, Loader2, KeyRound, Wand2, Link2, Pencil, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { DefaultUsuarioConfig } from "./DefaultUsuarioConfig";
import { BulkUserProvisioningWizard } from "./BulkUserProvisioningWizard";
import { AcessosEditorDialog } from "./AcessosEditorDialog";

// URL pública do app InFoco Messenger
const INFOCO_MESSENGER_URL = "https://desktop-joy-app.lovable.app";

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

interface UserAcessoRow {
  user_id: string;
  modulos: Record<string, string> | null;
  lojas: string[] | null;
  setores: string[] | null;
  acesso_total: boolean;
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

function useAllAcessos() {
  return useQuery({
    queryKey: ["admin-user-acessos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_acessos")
        .select("user_id, modulos, lojas, setores, acesso_total");
      if (error) throw error;
      return (data || []) as unknown as UserAcessoRow[];
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
  const { data: acessos, isLoading: loadingAcessos } = useAllAcessos();
  const { data: setores } = useSetores();
  const queryClient = useQueryClient();

  const [resetTarget, setResetTarget] = useState<{ id: string; nome: string } | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [editTargetId, setEditTargetId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [bulkWizardOpen, setBulkWizardOpen] = useState(false);
  const [magicLinkDialog, setMagicLinkDialog] = useState<{ url: string; email: string } | null>(null);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-profiles"] });
    queryClient.invalidateQueries({ queryKey: ["admin-user-acessos"] });
    queryClient.invalidateQueries({ queryKey: ["admin-user-roles"] });
    queryClient.invalidateQueries({ queryKey: ["profiles-ativos"] });
  };

  const acessoByUser = (id: string) => acessos?.find((a) => a.user_id === id);

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
        return;
      }
      setMagicLinkDialog({ url, email });
    },
    onError: (e: any) => toast.error(e.message ?? "Falha ao gerar link"),
  });

  const copyToClipboard = async (text: string): Promise<boolean> => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {}
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

  const toggleAtivo = useMutation({
    mutationFn: async ({ id, ativo }: { id: string; ativo: boolean }) => {
      const { error } = await supabase.from("profiles").update({ ativo }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => invalidateAll(),
    onError: (e: any) => toast.error(e.message ?? "Falha ao atualizar"),
  });

  const getSetorName = (setorId: string | null) =>
    !setorId ? null : setores?.find((s) => s.id === setorId)?.nome || "—";

  if (loadingProfiles || loadingAcessos) {
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
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Novo usuário
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <DefaultUsuarioConfig />

          <div className="mb-3 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground flex gap-2 items-start">
            <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
            <div>
              <strong className="text-foreground">Fonte única de permissões:</strong> tipo, módulos,
              lojas e setores são todos derivados de <code>Acessos</code>. O botão
              <span className="inline-block px-1"><Pencil className="inline h-3 w-3" /></span>
              abre o editor unificado — não há mais configurações paralelas.
            </div>
          </div>

          {!profiles?.length ? (
            <p className="text-sm text-muted-foreground text-center py-4">Nenhum usuário cadastrado</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Acesso</TableHead>
                  <TableHead>Escopo</TableHead>
                  <TableHead>Ativo</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {profiles.map((p: any) => {
                  const acc = acessoByUser(p.id);
                  const semAcesso = !acc;
                  const tipo = (p.tipo_usuario || "colaborador") as TipoUsuario;

                  // Escopo: prioriza user_acessos, fallback em profiles
                  const lojasEscopo: string[] =
                    acc?.lojas === null ? [] : (acc?.lojas ?? (p.lojas as string[] | null) ?? []);
                  const lojasTodas = acc?.lojas === null;
                  const setoresEscopo: string[] =
                    acc?.setores === null
                      ? []
                      : (acc?.setores ?? (p.setor_id ? [p.setor_id] : []));
                  const setoresTodos = acc?.setores === null;

                  // Resumo do acesso
                  const moduloCount = acc?.modulos ? Object.keys(acc.modulos).length : 0;
                  const acessoBadge = acc?.acesso_total
                    ? { label: "TOTAL", cls: "bg-amber-100 text-amber-800" }
                    : moduloCount > 0
                    ? { label: `${moduloCount} módulo${moduloCount === 1 ? "" : "s"}`, cls: "bg-blue-100 text-blue-800" }
                    : { label: "Sem acessos", cls: "bg-muted text-muted-foreground" };

                  return (
                    <TableRow key={p.id} className={semAcesso ? "bg-amber-50/30 dark:bg-amber-950/10" : ""}>
                      <TableCell className="font-medium">
                        {p.nome}
                        {semAcesso && (
                          <Badge variant="outline" className="ml-2 text-[9px] bg-amber-100 text-amber-800">
                            sem acessos
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">{p.email || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] ${TIPO_USUARIO_COLORS[tipo]}`}>
                          {TIPO_USUARIO_LABELS[tipo]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] ${acessoBadge.cls}`}>
                          {acessoBadge.label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {acc?.acesso_total ? (
                            <span className="text-xs text-muted-foreground">Tudo</span>
                          ) : (
                            <>
                              {lojasTodas && (
                                <Badge variant="outline" className="text-[10px]">Todas lojas</Badge>
                              )}
                              {!lojasTodas &&
                                lojasEscopo.slice(0, 3).map((l) => (
                                  <Badge key={l} variant="outline" className="text-[10px]">{l}</Badge>
                                ))}
                              {!lojasTodas && lojasEscopo.length > 3 && (
                                <Badge variant="outline" className="text-[10px]">
                                  +{lojasEscopo.length - 3}
                                </Badge>
                              )}
                              {setoresTodos && (
                                <Badge variant="outline" className="text-[10px]">Todos setores</Badge>
                              )}
                              {!setoresTodos &&
                                setoresEscopo.slice(0, 2).map((s) => (
                                  <Badge key={s} variant="outline" className="text-[10px]">
                                    {getSetorName(s)}
                                  </Badge>
                                ))}
                              {!lojasTodas && !setoresTodos && lojasEscopo.length === 0 && setoresEscopo.length === 0 && (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </>
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
                                onClick={() => setEditTargetId(p.id)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="left" className="text-xs">
                              Editar identidade, acessos e escopo
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
                              Gerar magic link
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

      {/* Editor unificado — único caminho de edição */}
      <AcessosEditorDialog
        userId={editTargetId}
        open={!!editTargetId}
        onOpenChange={(o) => !o && setEditTargetId(null)}
        onSaved={invalidateAll}
      />

      <AcessosEditorDialog
        userId={null}
        mode="create"
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={(_createdId, url) => {
          invalidateAll();
          if (url) setMagicLinkDialog({ url, email: "novo usuário" });
        }}
      />

      <Dialog open={!!resetTarget} onOpenChange={(o) => !o && setResetTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Redefinir senha</DialogTitle>
            <DialogDescription>
              Defina uma nova senha para <span className="font-medium">{resetTarget?.nome}</span>.
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
            <Button variant="ghost" onClick={() => setResetTarget(null)}>Cancelar</Button>
            <Button
              disabled={resetPassword.isPending || newPassword.length < 6 || !resetTarget}
              onClick={() =>
                resetTarget && resetPassword.mutate({ userId: resetTarget.id, password: newPassword })
              }
            >
              {resetPassword.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar nova senha"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BulkUserProvisioningWizard
        open={bulkWizardOpen}
        onOpenChange={setBulkWizardOpen}
        onComplete={invalidateAll}
      />

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
