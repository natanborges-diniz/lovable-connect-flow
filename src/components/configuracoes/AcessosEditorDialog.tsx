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
      // Esconde o setor legado "Loja" — escopo de loja se faz pelo campo Lojas.
      return (data as { id: string; nome: string }[]).filter(
        (s) => s.nome.trim().toLowerCase() !== "loja"
      );
    },
  });

  // ---- hydrate form when data arrives (ou reset em modo criação)
  useEffect(() => {
    if (!open) return;
    if (isCreate) {
      setNome("");
      setEmail("");
      setCargo("");
      setModulos({});
      setAcessoTotal(false);
      setLojas([]);
      setTodasLojas(false);
      setSetoresSel([]);
      setTodosSetores(false);
      setTab("identidade");
      return;
    }
    if (profileQ.data) {
      setNome(profileQ.data.nome || "");
      setEmail(profileQ.data.email || "");
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
  }, [open, isCreate, profileQ.data, acessosQ.data, acessosQ.isFetched]);

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

  // ---- save (cria ou atualiza)
  const save = useMutation({
    mutationFn: async () => {
      let targetUserId = userId;
      let inviteUrl: string | null = null;

      if (isCreate) {
        if (!nome.trim() || !email.trim()) {
          throw new Error("Informe nome e e-mail.");
        }
        const payload: Record<string, unknown> = {
          nome: nome.trim(),
          email: email.trim(),
          // role legado p/ compat (será sobrescrito pelo trigger de user_acessos)
          role: acessoTotal ? "admin" : "setor_usuario",
        };
        if (cargo.trim()) payload.cargo = cargo.trim();
        const { data, error } = await supabase.functions.invoke("admin-create-user", { body: payload });
        if (error) throw error;
        if ((data as any)?.error) throw new Error((data as any).error);
        targetUserId = (data as any).user_id;
        inviteUrl = (data as any).invite_url ?? null;
      } else {
        // edit: salva identidade
        const profileUpdates: { nome: string; cargo?: string } = { nome: nome.trim() };
        if (cargo.trim()) profileUpdates.cargo = cargo.trim();
        const { error: pErr } = await supabase
          .from("profiles")
          .update(profileUpdates)
          .eq("id", userId!);
        if (pErr) throw pErr;
      }

      if (!targetUserId) throw new Error("Sem user_id após criação");

      // user_acessos (upsert) — trigger se encarrega de profiles.tipo + user_roles
      const payload = {
        user_id: targetUserId,
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

      return { userId: targetUserId, inviteUrl };
    },
    onSuccess: (result) => {
      toast.success(isCreate ? "Usuário criado e acessos configurados" : "Acessos salvos");
      queryClient.invalidateQueries({ queryKey: ["admin-profiles"] });
      queryClient.invalidateQueries({ queryKey: ["admin-user-roles"] });
      queryClient.invalidateQueries({ queryKey: ["editor-acessos", userId] });
      queryClient.invalidateQueries({ queryKey: ["admin-user-acessos"] });
      queryClient.invalidateQueries({ queryKey: ["profiles-ativos"] });
      onSaved?.(result.userId, result.inviteUrl);
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message ?? "Falha ao salvar"),
  });

  const isLoading = !isCreate && (profileQ.isLoading || acessosQ.isLoading);

  const moduloCount = useMemo(() => Object.keys(modulos).length, [modulos]);
  const lojasResumo = todasLojas ? "Todas" : `${lojas.length} loja(s)`;
  const setoresResumo = todosSetores ? "Todos" : `${setoresSel.length} setor(es)`;
  const escopoChip = (() => {
    if (acessoTotal) return "TUDO";
    const temLoja = todasLojas || lojas.length > 0;
    const temSetor = todosSetores || setoresSel.length > 0;
    if (!temLoja && !temSetor) return "⚠ sem escopo";
    if (temLoja && !temSetor) return `Loja: ${lojasResumo}`;
    if (!temLoja && temSetor) return `Setor: ${setoresResumo}`;
    return `${lojasResumo} + ${setoresResumo}`;
  })();

  return (
    <TooltipProvider delayDuration={300}>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{isCreate ? "Novo usuário" : "Editar usuário e acessos"}</DialogTitle>
          <DialogDescription>
            Identidade • Acesso a módulos • Escopo (lojas / setores). Inclui o app
            <span className="font-medium"> InFoco Messenger</span> (celular).
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
                    {escopoChip}
                  </Badge>
                </TabsTrigger>
              </TabsList>

              <div className="flex-1 mt-3 pr-2 overflow-y-auto">
                {/* ---- IDENTIDADE ---- */}
                <TabsContent value="identidade" className="space-y-4">
                  <div className="space-y-2">
                    <Label>Nome</Label>
                    <Input value={nome} onChange={(e) => setNome(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>E-mail</Label>
                    <Input
                      value={isCreate ? email : (profileQ.data?.email || "")}
                      disabled={!isCreate}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={isCreate ? "usuario@empresa.com" : undefined}
                    />
                    <p className="text-xs text-muted-foreground">
                      {isCreate
                        ? "Será o identificador de login. Um link de acesso é gerado após salvar."
                        : "E-mail é o identificador de login e não pode ser alterado aqui."}
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
                        titulo="Atrium — este sistema (web no computador)"
                        subtitulo="Projeto: Lovable Connect & Flow"
                        descricao="Páginas que a pessoa abre aqui no navegador. Use para operadores internos: CRM, financeiro, TI, configurações."
                        icone={<Globe className="h-5 w-5" />}
                        accent="blue"
                        modulos={MODULOS_ATRIUM}
                        selecao={modulos}
                        onToggle={toggleModulo}
                        onPoder={setPoder}
                      />
                      <ModulosSection
                        titulo="InFoco Messenger — app no celular"
                        subtitulo="Projeto: Infoco Optical Business"
                        descricao="O que a pessoa enxerga ao abrir o app no celular. Use para lojas, supervisores e equipes em campo. Os menus específicos (lojista, supervisor) são filtrados pelo escopo da próxima aba."
                        icone={<Smartphone className="h-5 w-5" />}
                        accent="emerald"
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
                      <div className="border rounded-md p-3 bg-blue-50/60 dark:bg-blue-950/30 text-xs text-blue-900 dark:text-blue-200 space-y-1">
                        <div className="font-semibold flex items-center gap-1">
                          <Info className="h-3.5 w-3.5" /> Escolha <span className="underline">um</span> dos dois escopos abaixo — não os dois.
                        </div>
                        <div>
                          • <b>Lojas</b> — para quem trabalha <i>para</i> uma unidade física
                          (operador de loja, supervisor regional). Recebe agendamentos,
                          demandas e push das lojas marcadas.
                        </div>
                        <div>
                          • <b>Setores</b> — para quem trabalha <i>para</i> uma fila interna
                          (Financeiro, TI, Comercial, Estoque). Recebe as demandas roteadas
                          para esse setor.
                        </div>
                        <div className="opacity-80">
                          A maioria dos usuários marca <b>só um lado</b>. Diretor/admin usa "Acesso total".
                        </div>
                      </div>

                      {(() => {
                        const temLoja = todasLojas || lojas.length > 0;
                        const temSetor = todosSetores || setoresSel.length > 0;
                        const conflito = temLoja && temSetor;
                        const vazio = !temLoja && !temSetor;
                        return (
                          <>
                            {conflito && (
                              <div className="border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 rounded-md p-2 text-xs">
                                ⚠ Você marcou <b>Lojas</b> e <b>Setores</b> ao mesmo tempo.
                                Isso só faz sentido em casos raros (ex.: diretor regional).
                                Se for operador de loja, deixe Setores vazio. Se for de
                                setor interno, deixe Lojas vazio.
                              </div>
                            )}
                            {vazio && (
                              <div className="border border-destructive/40 bg-destructive/5 text-destructive rounded-md p-2 text-xs">
                                ⚠ Nenhum escopo definido. O usuário não vai receber nada.
                                Marque ao menos uma loja <b>ou</b> um setor (ou ative "Acesso total").
                              </div>
                            )}
                          </>
                        );
                      })()}

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
                        <p className="text-[11px] text-muted-foreground mb-2">
                          Apenas filas internas por especialidade (Financeiro, TI, Comercial,
                          Estoque). <b>Não existe setor "Loja" aqui</b> — para vincular
                          alguém a uma unidade, use o campo Lojas acima.
                        </p>
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
              </div>
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
    </TooltipProvider>
  );
}

function ModulosSection({
  titulo,
  subtitulo,
  descricao,
  icone,
  accent = "blue",
  modulos,
  selecao,
  onToggle,
  onPoder,
}: {
  titulo: string;
  subtitulo?: string;
  descricao?: string;
  icone?: React.ReactNode;
  accent?: "blue" | "emerald";
  modulos: { key: ModuloKey; label: string; descricao?: string }[];
  selecao: Partial<Record<ModuloKey, Poder>>;
  onToggle: (k: ModuloKey, checked: boolean) => void;
  onPoder: (k: ModuloKey, p: Poder) => void;
}) {
  const accentStyles =
    accent === "emerald"
      ? "border-emerald-300 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200"
      : "border-blue-300 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-950/30 text-blue-900 dark:text-blue-200";
  const selecionados = modulos.filter((m) => selecao[m.key] != null).length;
  return (
    <div className="border-2 rounded-lg overflow-hidden">
      <div className={`flex items-start gap-3 p-3 border-b-2 ${accentStyles}`}>
        <div className="mt-0.5">{icone}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-sm font-bold">{titulo}</div>
            <Badge variant="secondary" className="text-[10px]">
              {selecionados}/{modulos.length}
            </Badge>
          </div>
          {subtitulo && (
            <div className="text-[11px] uppercase tracking-wide opacity-70 font-medium">
              {subtitulo}
            </div>
          )}
          {descricao && (
            <div className="text-xs mt-1 opacity-90">{descricao}</div>
          )}
        </div>
      </div>
      <div className="divide-y bg-background">
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
                {m.descricao && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs text-xs">
                      {m.descricao}
                    </TooltipContent>
                  </Tooltip>
                )}
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
