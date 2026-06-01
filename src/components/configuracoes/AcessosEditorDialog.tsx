import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { Loader2, Shield, KeySquare, MapPin, Sparkles, Info, Globe, Smartphone } from "lucide-react";
import {
  type Acessos,
  type ModuloKey,
  type Poder,
  MODULOS_ATRIUM,
  MODULOS_MESSENGER,
  PERFIS_RAPIDOS,
} from "@/lib/acessos";

interface Props {
  /** null + mode="create" cria novo. uuid + mode="edit" edita. */
  userId: string | null;
  mode?: "edit" | "create";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (createdUserId?: string, inviteUrl?: string | null) => void;
}

interface ProfileRow {
  id: string;
  nome: string;
  email: string | null;
  cargo: string | null;
}

export function AcessosEditorDialog({ userId, mode = "edit", open, onOpenChange, onSaved }: Props) {
  const queryClient = useQueryClient();
  const isCreate = mode === "create";
  const [tab, setTab] = useState("identidade");

  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [cargo, setCargo] = useState("");
  const [modulos, setModulos] = useState<Partial<Record<ModuloKey, Poder>>>({});
  const [lojas, setLojas] = useState<string[]>([]);
  const [todasLojas, setTodasLojas] = useState(false);
  const [setoresSel, setSetoresSel] = useState<string[]>([]);
  const [todosSetores, setTodosSetores] = useState(false);
  const [acessoTotal, setAcessoTotal] = useState(false);

  // ---- queries
  const profileQ = useQuery({
    queryKey: ["editor-profile", userId],
    enabled: !!userId && !isCreate && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, nome, email, cargo")
        .eq("id", userId!)
        .single();
      if (error) throw error;
      return data as ProfileRow;
    },
  });

  const acessosQ = useQuery({
    queryKey: ["editor-acessos", userId],
    enabled: !!userId && !isCreate && open,
    queryFn: async (): Promise<Acessos | null> => {
      const { data, error } = await supabase
        .from("user_acessos")
        .select("modulos, lojas, setores, acesso_total")
        .eq("user_id", userId!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        modulos: (data.modulos as any) || {},
        lojas: data.lojas,
        setores: data.setores,
        acessoTotal: !!data.acesso_total,
      };
    },
  });

  const lojasQ = useQuery({
    queryKey: ["editor-lojas-disponiveis"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("telefones_lojas")
        .select("nome_loja")
        .eq("tipo", "loja")
        .eq("ativo", true);
      if (error) throw error;
      return [...new Set((data || []).map((d: any) => d.nome_loja))].sort();
    },
  });

  const setoresQ = useQuery({
    queryKey: ["editor-setores-disponiveis"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("setores")
        .select("id, nome")
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return data as { id: string; nome: string }[];
    },
  });

  // ---- hydrate form when data arrives
  useEffect(() => {
    if (!open) return;
    if (profileQ.data) {
      setNome(profileQ.data.nome || "");
      setCargo(profileQ.data.cargo || "");
    }
    const a = acessosQ.data;
    if (a) {
      setModulos(a.modulos);
      setAcessoTotal(a.acessoTotal);
      setLojas(a.lojas || []);
      setTodasLojas(a.lojas === null);
      setSetoresSel(a.setores || []);
      setTodosSetores(a.setores === null);
    } else if (acessosQ.isFetched) {
      // novo registro
      setModulos({});
      setAcessoTotal(false);
      setLojas([]);
      setTodasLojas(false);
      setSetoresSel([]);
      setTodosSetores(false);
    }
  }, [open, profileQ.data, acessosQ.data, acessosQ.isFetched]);

  const toggleModulo = (k: ModuloKey, checked: boolean) => {
    setModulos((prev) => {
      const next = { ...prev };
      if (checked) next[k] = next[k] || "agir";
      else delete next[k];
      return next;
    });
  };
  const setPoder = (k: ModuloKey, p: Poder) =>
    setModulos((prev) => ({ ...prev, [k]: p }));

  const aplicarPerfil = (id: string) => {
    const perfil = PERFIS_RAPIDOS.find((p) => p.id === id);
    if (!perfil) return;
    const patch = perfil.apply();
    if (patch.modulos) setModulos(patch.modulos as any);
    if (patch.acessoTotal !== undefined) setAcessoTotal(patch.acessoTotal);
    if (patch.lojas === null) setTodasLojas(true);
    if (patch.setores === null) setTodosSetores(true);
    toast.success(`Perfil "${perfil.label}" aplicado — ajuste o escopo se precisar.`);
  };

  // ---- save
  const save = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error("Sem usuário");
      // 1) profile (identidade)
      const profileUpdates: { nome: string; cargo?: string } = { nome: nome.trim() };
      if (cargo.trim()) profileUpdates.cargo = cargo.trim();
      const { error: pErr } = await supabase
        .from("profiles")
        .update(profileUpdates)
        .eq("id", userId);
      if (pErr) throw pErr;


      // 2) user_acessos (upsert) — trigger se encarrega de profiles.tipo + user_roles
      const payload = {
        user_id: userId,
        modulos: acessoTotal
          ? Object.fromEntries(
              [...MODULOS_ATRIUM, ...MODULOS_MESSENGER].map((m) => [m.key, "agir"])
            )
          : modulos,
        lojas: todasLojas ? null : lojas,
        setores: todosSetores ? null : setoresSel,
        acesso_total: acessoTotal,
      };
      const { error: aErr } = await supabase.from("user_acessos").upsert(payload);
      if (aErr) throw aErr;
    },
    onSuccess: () => {
      toast.success("Acessos salvos");
      queryClient.invalidateQueries({ queryKey: ["admin-profiles"] });
      queryClient.invalidateQueries({ queryKey: ["admin-user-roles"] });
      queryClient.invalidateQueries({ queryKey: ["editor-acessos", userId] });
      queryClient.invalidateQueries({ queryKey: ["admin-user-acessos"] });
      onSaved?.();
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message ?? "Falha ao salvar"),
  });

  const isLoading = profileQ.isLoading || acessosQ.isLoading;

  const moduloCount = useMemo(() => Object.keys(modulos).length, [modulos]);
  const lojasResumo = todasLojas ? "Todas" : `${lojas.length} loja(s)`;
  const setoresResumo = todosSetores ? "Todos" : `${setoresSel.length} setor(es)`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Editar usuário e acessos</DialogTitle>
          <DialogDescription>
            Identidade • Acesso a módulos • Escopo (lojas / setores). Quem cuida do
            <span className="font-medium"> InFoco Messenger</span> também é configurado aqui.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Atalhos rápidos */}
            <div className="border rounded-md p-3 bg-muted/30">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Atalhos de perfil</span>
                <span className="text-xs text-muted-foreground">
                  (só preenche os campos — você ajusta depois)
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {PERFIS_RAPIDOS.map((p) => (
                  <Button
                    key={p.id}
                    size="sm"
                    variant="outline"
                    onClick={() => aplicarPerfil(p.id)}
                    title={p.descricao}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            </div>

            <Tabs value={tab} onValueChange={setTab} className="flex-1 overflow-hidden flex flex-col">
              <TabsList className="grid grid-cols-3">
                <TabsTrigger value="identidade">
                  <Shield className="h-4 w-4 mr-1" /> Identidade
                </TabsTrigger>
                <TabsTrigger value="acesso">
                  <KeySquare className="h-4 w-4 mr-1" /> Acesso{" "}
                  <Badge variant="secondary" className="ml-2">
                    {acessoTotal ? "TOTAL" : moduloCount}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="escopo">
                  <MapPin className="h-4 w-4 mr-1" /> Escopo{" "}
                  <Badge variant="secondary" className="ml-2">
                    {acessoTotal ? "TUDO" : `${lojasResumo} / ${setoresResumo}`}
                  </Badge>
                </TabsTrigger>
              </TabsList>

              <ScrollArea className="flex-1 mt-3 pr-3">
                {/* ---- IDENTIDADE ---- */}
                <TabsContent value="identidade" className="space-y-4">
                  <div className="space-y-2">
                    <Label>Nome</Label>
                    <Input value={nome} onChange={(e) => setNome(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>E-mail</Label>
                    <Input value={profileQ.data?.email || ""} disabled />
                    <p className="text-xs text-muted-foreground">
                      E-mail é o identificador de login e não pode ser alterado aqui.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Cargo (descritivo)</Label>
                    <Input
                      value={cargo}
                      onChange={(e) => setCargo(e.target.value)}
                      placeholder="Ex.: Supervisora de lojas, Diretor, Auxiliar financeiro"
                    />
                    <p className="text-xs text-muted-foreground">
                      Apenas para identificação visual. As permissões reais ficam na aba
                      <span className="font-medium"> Acesso</span>.
                    </p>
                  </div>
                </TabsContent>

                {/* ---- ACESSO ---- */}
                <TabsContent value="acesso" className="space-y-4">
                  <div className="flex items-center justify-between border rounded-md p-3 bg-amber-50 dark:bg-amber-950/30">
                    <div>
                      <div className="font-medium text-sm">Acesso total (Diretor)</div>
                      <div className="text-xs text-muted-foreground">
                        Vê e age em qualquer módulo, exceto Configurações, em qualquer loja/setor.
                      </div>
                    </div>
                    <Switch checked={acessoTotal} onCheckedChange={setAcessoTotal} />
                  </div>

                  {!acessoTotal && (
                    <>
                      <ModulosSection
                        titulo="Módulos do Atrium (web)"
                        modulos={MODULOS_ATRIUM}
                        selecao={modulos}
                        onToggle={toggleModulo}
                        onPoder={setPoder}
                      />
                      <ModulosSection
                        titulo="Módulos do InFoco Messenger"
                        modulos={MODULOS_MESSENGER}
                        selecao={modulos}
                        onToggle={toggleModulo}
                        onPoder={setPoder}
                      />
                    </>
                  )}
                </TabsContent>

                {/* ---- ESCOPO ---- */}
                <TabsContent value="escopo" className="space-y-6">
                  {acessoTotal ? (
                    <div className="text-sm text-muted-foreground italic border rounded-md p-4">
                      Acesso total cobre todas as lojas e setores automaticamente.
                    </div>
                  ) : (
                    <>
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <Label className="text-sm font-medium">Lojas</Label>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">Todas</span>
                            <Switch checked={todasLojas} onCheckedChange={setTodasLojas} />
                          </div>
                        </div>
                        {!todasLojas && (
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 border rounded-md p-3 max-h-60 overflow-auto">
                            {(lojasQ.data || []).map((l) => (
                              <label key={l} className="flex items-center gap-2 text-sm">
                                <Checkbox
                                  checked={lojas.includes(l)}
                                  onCheckedChange={(c) =>
                                    setLojas((prev) =>
                                      c ? [...prev, l] : prev.filter((x) => x !== l)
                                    )
                                  }
                                />
                                <span className="truncate">{l}</span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <Label className="text-sm font-medium">Setores</Label>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">Todos</span>
                            <Switch checked={todosSetores} onCheckedChange={setTodosSetores} />
                          </div>
                        </div>
                        {!todosSetores && (
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 border rounded-md p-3 max-h-60 overflow-auto">
                            {(setoresQ.data || []).map((s) => (
                              <label key={s.id} className="flex items-center gap-2 text-sm">
                                <Checkbox
                                  checked={setoresSel.includes(s.id)}
                                  onCheckedChange={(c) =>
                                    setSetoresSel((prev) =>
                                      c ? [...prev, s.id] : prev.filter((x) => x !== s.id)
                                    )
                                  }
                                />
                                <span className="truncate">{s.nome}</span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </TabsContent>
              </ScrollArea>
            </Tabs>

            <DialogFooter className="mt-4">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Salvar
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ModulosSection({
  titulo,
  modulos,
  selecao,
  onToggle,
  onPoder,
}: {
  titulo: string;
  modulos: { key: ModuloKey; label: string }[];
  selecao: Partial<Record<ModuloKey, Poder>>;
  onToggle: (k: ModuloKey, checked: boolean) => void;
  onPoder: (k: ModuloKey, p: Poder) => void;
}) {
  return (
    <div>
      <div className="text-sm font-medium mb-2">{titulo}</div>
      <div className="border rounded-md divide-y">
        {modulos.map((m) => {
          const checked = selecao[m.key] != null;
          return (
            <div key={m.key} className="flex items-center justify-between p-2">
              <label className="flex items-center gap-2 text-sm flex-1 cursor-pointer">
                <Checkbox
                  checked={checked}
                  onCheckedChange={(c) => onToggle(m.key, !!c)}
                />
                <span>{m.label}</span>
              </label>
              {checked && (
                <Select
                  value={selecao[m.key]}
                  onValueChange={(v) => onPoder(m.key, v as Poder)}
                >
                  <SelectTrigger className="w-32 h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ver">Ver</SelectItem>
                    <SelectItem value="agir">Agir</SelectItem>
                    <SelectItem value="encerrar">Encerrar</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
