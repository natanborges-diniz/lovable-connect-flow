import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ArrowLeft, ArrowRight, Wand2, Check, AlertCircle, Copy } from "lucide-react";
import { toast } from "sonner";

type TipoUsuario = "loja" | "colaborador" | "setor_operador" | "admin";
type Fonte = "telefones_lojas" | "fluxo_responsaveis";

interface Candidate {
  key: string;
  selected: boolean;
  email: string;
  nome: string;
  telefone: string;
  tipo_usuario: TipoUsuario;
  setor_id: string | null;
  loja_nome: string | null;
  cargo: string | null;
  origem: Fonte;
  jaCadastrado: boolean;
  motivoSkip?: string;
}

interface ResultRow {
  email: string;
  nome: string;
  status: "created" | "exists" | "error";
  user_id?: string;
  invite_url?: string;
  message?: string;
}

const TIPO_LABELS: Record<TipoUsuario, string> = {
  loja: "Loja",
  colaborador: "Colaborador",
  setor_operador: "Operador de Setor",
  admin: "Admin",
};

const TIPO_COLORS: Record<TipoUsuario, string> = {
  loja: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  colaborador: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  setor_operador: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  admin: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
};

function slugifyEmail(nome: string, suffix = "oticasdiniz.local"): string {
  const base = nome
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 40);
  return `${base || "usuario"}@${suffix}`;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onComplete?: () => void;
}

export function BulkUserProvisioningWizard({ open, onOpenChange, onComplete }: Props) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [fonte, setFonte] = useState<Fonte>("telefones_lojas");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [defaultPassword, setDefaultPassword] = useState<string>("Atrium@2026");

  const reset = () => {
    setStep(1);
    setCandidates([]);
    setResults([]);
    setSubmitting(false);
  };

  useEffect(() => {
    if (!open) reset();
  }, [open]);

  // Fetch sources in parallel
  const { data: telefones } = useQuery({
    queryKey: ["bulk-wizard-telefones"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("telefones_lojas")
        .select("id, nome_loja, nome_colaborador, telefone, tipo, cargo, setor_destino_id, ativo")
        .eq("ativo", true);
      if (error) throw error;
      return data || [];
    },
    enabled: open,
  });

  const { data: fluxoResp } = useQuery({
    queryKey: ["bulk-wizard-fluxo-resp"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("fluxo_responsaveis")
        .select("id, fluxo_chave, nome, telefone, ativo")
        .eq("ativo", true);
      if (error) throw error;
      return data || [];
    },
    enabled: open,
  });

  const { data: botFluxos } = useQuery({
    queryKey: ["bulk-wizard-bot-fluxos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bot_fluxos")
        .select("chave, nome, setor_destino_id");
      if (error) throw error;
      return data || [];
    },
    enabled: open,
  });

  const { data: setores } = useQuery({
    queryKey: ["bulk-wizard-setores"],
    queryFn: async () => {
      const { data, error } = await supabase.from("setores").select("id, nome").eq("ativo", true);
      if (error) throw error;
      return data || [];
    },
    enabled: open,
  });

  const { data: existingProfiles } = useQuery({
    queryKey: ["bulk-wizard-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, email, metadata");
      if (error) throw error;
      return data || [];
    },
    enabled: open,
  });

  const setorNome = (id: string | null) =>
    id ? setores?.find((s) => s.id === id)?.nome ?? "—" : "—";

  // Build candidates whenever fonte/source data changes
  useEffect(() => {
    if (!open || step !== 2) return;

    const profileTelefones = new Set<string>();
    const profileEmails = new Set<string>();
    (existingProfiles || []).forEach((p: any) => {
      if (p.email) profileEmails.add(String(p.email).toLowerCase());
      const t = p?.metadata?.telefone;
      if (t) profileTelefones.add(String(t).replace(/\D/g, ""));
    });

    let next: Candidate[] = [];

    if (fonte === "telefones_lojas") {
      next = (telefones || []).map((t: any) => {
        const cleanTel = String(t.telefone || "").replace(/\D/g, "");
        const nome =
          t.tipo === "colaborador" && t.nome_colaborador
            ? t.nome_colaborador
            : t.nome_loja;
        let tipo_usuario: TipoUsuario = "loja";
        if (t.tipo === "colaborador") tipo_usuario = "colaborador";
        else if (t.tipo === "departamento") tipo_usuario = "setor_operador";
        const ja = profileTelefones.has(cleanTel);
        return {
          key: `tel-${t.id}`,
          selected: !ja,
          email: "",
          nome,
          telefone: cleanTel,
          tipo_usuario,
          setor_id: t.setor_destino_id || null,
          loja_nome: t.tipo === "loja" ? t.nome_loja : null,
          cargo: t.cargo || null,
          origem: "telefones_lojas" as Fonte,
          jaCadastrado: ja,
          motivoSkip: ja ? "Telefone já vinculado a usuário existente" : undefined,
        };
      });
    } else {
      next = (fluxoResp || []).map((r: any) => {
        const cleanTel = String(r.telefone || "").replace(/\D/g, "");
        const fluxo = (botFluxos || []).find((f: any) => f.chave === r.fluxo_chave);
        const ja = profileTelefones.has(cleanTel);
        return {
          key: `flx-${r.id}`,
          selected: !ja,
          email: "",
          nome: r.nome,
          telefone: cleanTel,
          tipo_usuario: "setor_operador" as TipoUsuario,
          setor_id: fluxo?.setor_destino_id || null,
          loja_nome: null,
          cargo: null,
          origem: "fluxo_responsaveis" as Fonte,
          jaCadastrado: ja,
          motivoSkip: ja ? "Telefone já vinculado a usuário existente" : undefined,
        };
      });
    }

    // Dedupe by phone within source
    const seen = new Set<string>();
    next = next.filter((c) => {
      if (!c.telefone) return true;
      if (seen.has(c.telefone)) return false;
      seen.add(c.telefone);
      return true;
    });

    setCandidates(next);
  }, [fonte, step, open, telefones, fluxoResp, botFluxos, existingProfiles]);

  const updateCandidate = (key: string, patch: Partial<Candidate>) => {
    setCandidates((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  };

  const fillEmailsAuto = () => {
    setCandidates((prev) =>
      prev.map((c) =>
        c.email || !c.selected || c.jaCadastrado
          ? c
          : { ...c, email: slugifyEmail(c.nome) },
      ),
    );
    toast.success("E-mails sugeridos preenchidos");
  };

  const selectedCount = candidates.filter((c) => c.selected && !c.jaCadastrado).length;
  const validCount = candidates.filter(
    (c) => c.selected && !c.jaCadastrado && c.email.includes("@"),
  ).length;

  const submit = async () => {
    setSubmitting(true);
    setResults([]);
    try {
      const toSend = candidates.filter(
        (c) => c.selected && !c.jaCadastrado && c.email.includes("@"),
      );

      // Chunk into batches of 10
      const chunks: Candidate[][] = [];
      for (let i = 0; i < toSend.length; i += 10) chunks.push(toSend.slice(i, i + 10));

      const all: ResultRow[] = [];
      for (const chunk of chunks) {
        const payload = {
          candidates: chunk.map((c) => ({
            email: c.email.trim().toLowerCase(),
            nome: c.nome,
            tipo_usuario: c.tipo_usuario,
            setor_id: c.setor_id,
            loja_nome: c.loja_nome,
            cargo: c.cargo,
            telefone: c.telefone,
            origem: c.origem,
          })),
        };
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData?.session?.access_token;
        if (!accessToken) {
          throw new Error("Sessão expirada. Faça login novamente.");
        }
        const { data, error } = await supabase.functions.invoke(
          "admin-bulk-provision-users",
          {
            body: payload,
            headers: { Authorization: `Bearer ${accessToken}` },
          },
        );
        if (error) throw error;
        if ((data as any)?.error) throw new Error((data as any).error);
        all.push(...((data as any)?.results || []));
        setResults([...all]);
      }

      const created = all.filter((r) => r.status === "created").length;
      const exists = all.filter((r) => r.status === "exists").length;
      const errors = all.filter((r) => r.status === "error").length;
      toast.success(`Processados: ${created} criados, ${exists} já existiam, ${errors} erros`);
      onComplete?.();
    } catch (e: any) {
      toast.error(e?.message ?? "Falha no provisionamento");
    } finally {
      setSubmitting(false);
    }
  };

  const copyAllInvites = () => {
    const links = results
      .filter((r) => r.invite_url)
      .map((r) => `${r.nome} (${r.email}): ${r.invite_url}`)
      .join("\n");
    if (!links) {
      toast.info("Nenhum link de convite disponível");
      return;
    }
    navigator.clipboard.writeText(links);
    toast.success("Links copiados");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-5 w-5" /> Cadastrar usuários do Messenger em lote
          </DialogTitle>
          <DialogDescription>
            Passo {step} de 4 — reaproveita os contatos já cadastrados em Telefones Corporativos e
            Responsáveis de Fluxo.
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-3 py-4">
            <Label>Selecione a origem dos cadastros</Label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <button
                onClick={() => setFonte("telefones_lojas")}
                className={`text-left rounded-lg border p-4 transition ${
                  fonte === "telefones_lojas"
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                }`}
              >
                <p className="font-medium text-sm">Lojas, colaboradores e departamentos</p>
                <p className="text-xs text-muted-foreground mt-1">
                  De <code>telefones_lojas</code> ({telefones?.length ?? 0} ativos)
                </p>
              </button>
              <button
                onClick={() => setFonte("fluxo_responsaveis")}
                className={`text-left rounded-lg border p-4 transition ${
                  fonte === "fluxo_responsaveis"
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                }`}
              >
                <p className="font-medium text-sm">Operadores de setor (Responsáveis de Fluxo)</p>
                <p className="text-xs text-muted-foreground mt-1">
                  De <code>fluxo_responsaveis</code> ({fluxoResp?.length ?? 0} ativos)
                </p>
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                Marque quem cadastrar e preencha o e-mail. Linhas em cinza já existem.
              </p>
              <Button size="sm" variant="outline" onClick={fillEmailsAuto}>
                Sugerir e-mails
              </Button>
            </div>
            <div className="border rounded-lg max-h-[400px] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>Telefone</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Setor</TableHead>
                    <TableHead>E-mail *</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {candidates.map((c) => (
                    <TableRow
                      key={c.key}
                      className={c.jaCadastrado ? "opacity-50" : ""}
                    >
                      <TableCell>
                        <Checkbox
                          checked={c.selected}
                          disabled={c.jaCadastrado}
                          onCheckedChange={(v) =>
                            updateCandidate(c.key, { selected: !!v })
                          }
                        />
                      </TableCell>
                      <TableCell className="font-medium text-sm">
                        {c.nome}
                        {c.jaCadastrado && (
                          <Badge variant="outline" className="ml-2 text-[10px]">
                            já existe
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{c.telefone || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] ${TIPO_COLORS[c.tipo_usuario]}`}>
                          {TIPO_LABELS[c.tipo_usuario]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{setorNome(c.setor_id)}</TableCell>
                      <TableCell>
                        <Input
                          type="email"
                          className="h-7 text-xs"
                          placeholder="email@dominio.com"
                          value={c.email}
                          disabled={c.jaCadastrado}
                          onChange={(e) => updateCandidate(c.key, { email: e.target.value })}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                  {candidates.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">
                        Nenhum cadastro encontrado nesta fonte.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground">
              Selecionados: <strong>{selectedCount}</strong> · Com e-mail válido:{" "}
              <strong>{validCount}</strong>
            </p>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Confirme/ajuste o tipo de cada usuário. Esse mapeamento controla quem pode iniciar
              conversas 1-a-1 com quem no Messenger.
            </p>
            <div className="border rounded-lg max-h-[400px] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>E-mail</TableHead>
                    <TableHead>Tipo (Messenger)</TableHead>
                    <TableHead>Setor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {candidates
                    .filter((c) => c.selected && !c.jaCadastrado && c.email.includes("@"))
                    .map((c) => (
                      <TableRow key={c.key}>
                        <TableCell className="text-sm">{c.nome}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{c.email}</TableCell>
                        <TableCell>
                          <Select
                            value={c.tipo_usuario}
                            onValueChange={(v) =>
                              updateCandidate(c.key, { tipo_usuario: v as TipoUsuario })
                            }
                          >
                            <SelectTrigger className="h-7 w-40 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="loja">Loja</SelectItem>
                              <SelectItem value="colaborador">Colaborador</SelectItem>
                              <SelectItem value="setor_operador">Operador de Setor</SelectItem>
                              <SelectItem value="admin">Admin</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={c.setor_id || "__none__"}
                            onValueChange={(v) =>
                              updateCandidate(c.key, {
                                setor_id: v === "__none__" ? null : v,
                              })
                            }
                          >
                            <SelectTrigger className="h-7 w-40 text-xs">
                              <SelectValue placeholder="Sem setor" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">Sem setor</SelectItem>
                              {setores?.map((s) => (
                                <SelectItem key={s.id} value={s.id}>
                                  {s.nome}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-3 py-2">
            {results.length === 0 && !submitting && (
              <div className="rounded-lg border border-dashed p-6 text-center">
                <p className="text-sm">
                  Pronto para criar <strong>{validCount}</strong> usuários no Messenger.
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Cada um receberá um link de convite para definir senha no primeiro acesso.
                </p>
              </div>
            )}
            {submitting && (
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" /> Provisionando...
              </div>
            )}
            {results.length > 0 && (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-sm">
                    {results.filter((r) => r.status === "created").length} criados ·{" "}
                    {results.filter((r) => r.status === "exists").length} existiam ·{" "}
                    {results.filter((r) => r.status === "error").length} erros
                  </p>
                  <Button size="sm" variant="outline" onClick={copyAllInvites}>
                    <Copy className="h-3.5 w-3.5 mr-1" /> Copiar todos os links
                  </Button>
                </div>
                <div className="border rounded-lg max-h-[400px] overflow-y-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background">
                      <TableRow>
                        <TableHead>Status</TableHead>
                        <TableHead>Nome / E-mail</TableHead>
                        <TableHead>Convite</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {results.map((r, idx) => (
                        <TableRow key={`${r.email}-${idx}`}>
                          <TableCell>
                            {r.status === "created" && (
                              <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                                <Check className="h-3 w-3 mr-1" /> criado
                              </Badge>
                            )}
                            {r.status === "exists" && (
                              <Badge variant="outline">existia</Badge>
                            )}
                            {r.status === "error" && (
                              <Badge variant="destructive">
                                <AlertCircle className="h-3 w-3 mr-1" /> erro
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs">
                            <div className="font-medium">{r.nome}</div>
                            <div className="text-muted-foreground">{r.email}</div>
                            {r.message && (
                              <div className="text-muted-foreground italic">{r.message}</div>
                            )}
                          </TableCell>
                          <TableCell>
                            {r.invite_url ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 text-[10px]"
                                onClick={() => {
                                  navigator.clipboard.writeText(r.invite_url!);
                                  toast.success("Link copiado");
                                }}
                              >
                                <Copy className="h-3 w-3 mr-1" /> copiar
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </div>
        )}

        <DialogFooter className="flex justify-between sm:justify-between">
          <div>
            {step > 1 && results.length === 0 && (
              <Button variant="ghost" onClick={() => setStep((s) => (s - 1) as any)}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            {step < 4 && (
              <Button
                onClick={() => setStep((s) => (s + 1) as any)}
                disabled={
                  (step === 2 && validCount === 0) ||
                  (step === 3 && validCount === 0)
                }
              >
                Avançar <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            )}
            {step === 4 && results.length === 0 && (
              <Button onClick={submit} disabled={submitting || validCount === 0}>
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  `Provisionar ${validCount} usuários`
                )}
              </Button>
            )}
            {step === 4 && results.length > 0 && (
              <Button onClick={() => onOpenChange(false)}>Concluir</Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
