import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Loader2, Store, Users, Search, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { useLojas } from "@/hooks/useLojas";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opcional: quando aberto a partir de um atendimento humano vincula a demanda ao cliente. */
  atendimentoId?: string | null;
  onCreated?: (demandaId: string) => void;
}

export function AcionarLojaDialog({ open, onOpenChange, atendimentoId, onCreated }: Props) {
  const { data: lojas = [], isLoading } = useLojas();
  const [grupo, setGrupo] = useState(false);
  const [lojaUnica, setLojaUnica] = useState<string>("");
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [assunto, setAssunto] = useState("");
  const [pergunta, setPergunta] = useState("");
  const [busca, setBusca] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [anexo, setAnexo] = useState<File | null>(null);

  const filtradas = busca.trim()
    ? lojas.filter((l) => l.nome_loja.toLowerCase().includes(busca.toLowerCase()))
    : lojas;

  const reset = () => {
    setGrupo(false);
    setLojaUnica("");
    setSelecionadas(new Set());
    setAssunto("");
    setPergunta("");
    setBusca("");
    setAnexo(null);
  };

  const toggle = (nome: string) => {
    const next = new Set(selecionadas);
    if (next.has(nome)) next.delete(nome);
    else next.add(nome);
    setSelecionadas(next);
  };

  const selecionarTodas = () => setSelecionadas(new Set(filtradas.map((l) => l.nome_loja)));
  const limpar = () => setSelecionadas(new Set());

  const podeEnviar =
    pergunta.trim().length >= 1 &&
    pergunta.trim().length <= 2000 &&
    assunto.trim().length <= 120 &&
    (grupo ? selecionadas.size >= 1 : !!lojaUnica);

  const handleSubmit = async () => {
    if (!podeEnviar) return;
    setEnviando(true);
    try {
      // Upload do anexo (opcional) — bucket público mensagens-anexos
      let anexo_url: string | null = null;
      let anexo_mime: string | null = null;
      if (anexo) {
        const ext = anexo.name.split(".").pop()?.toLowerCase() || "bin";
        const path = `demandas/${new Date().getFullYear()}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("mensagens-anexos")
          .upload(path, anexo, { contentType: anexo.type, upsert: false });
        if (upErr) throw new Error("Falha no upload: " + upErr.message);
        const { data: pub } = supabase.storage.from("mensagens-anexos").getPublicUrl(path);
        anexo_url = pub.publicUrl;
        anexo_mime = anexo.type || null;
      }

      let body: Record<string, unknown> = {
        atendimento_id: atendimentoId ?? null,
        assunto: assunto.trim() || null,
        pergunta: pergunta.trim(),
        anexo_url,
        anexo_mime,
      };
      if (grupo) {
        const lojasPayload = lojas
          .filter((l) => selecionadas.has(l.nome_loja))
          .map((l) => ({ nome_loja: l.nome_loja, telefone: l.telefone }));
        body.lojas = lojasPayload;
      } else {
        const loja = lojas.find((l) => l.nome_loja === lojaUnica);
        if (!loja) throw new Error("Loja inválida");
        body.loja_nome = loja.nome_loja;
        body.loja_telefone = loja.telefone;
      }

      const { data, error } = await supabase.functions.invoke("criar-demanda-loja", { body });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);

      toast.success(`Demanda criada • ${(data as any)?.protocolo ?? "OK"}`);
      onCreated?.((data as any)?.demanda_id);
      reset();
      onOpenChange(false);
    } catch (e: any) {
      toast.error("Falha ao criar demanda: " + (e?.message ?? "erro"));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Store className="h-4 w-4 text-primary" /> Acionar loja(s)
          </DialogTitle>
          <DialogDescription className="text-xs">
            Abre uma demanda interna em modo grupo (estilo WhatsApp). A(s) loja(s) responde(m) pelo
            app InFoco Messenger e todas veem as mensagens umas das outras.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-md border p-2">
            <div className="flex items-center gap-2 text-xs">
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
              <span>Acionar várias lojas (modo grupo)</span>
            </div>
            <Switch checked={grupo} onCheckedChange={(v) => { setGrupo(v); setSelecionadas(new Set()); setLojaUnica(""); }} />
          </div>

          {!grupo ? (
            <div className="space-y-1">
              <Label className="text-xs">Loja</Label>
              <select
                value={lojaUnica}
                onChange={(e) => setLojaUnica(e.target.value)}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                disabled={isLoading}
              >
                <option value="">{isLoading ? "Carregando…" : "Selecione uma loja"}</option>
                {lojas.map((l) => (
                  <option key={l.nome_loja} value={l.nome_loja}>{l.nome_loja}</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs">Lojas ({selecionadas.size} selecionada{selecionadas.size === 1 ? "" : "s"})</Label>
                <div className="flex gap-1">
                  <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={selecionarTodas}>Todas</Button>
                  <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={limpar}>Limpar</Button>
                </div>
              </div>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Filtrar lojas…"
                  className="h-8 pl-7 text-xs"
                />
              </div>
              <ScrollArea className="h-44 rounded-md border">
                <ul className="divide-y">
                  {filtradas.map((l) => {
                    const checked = selecionadas.has(l.nome_loja);
                    return (
                      <li key={l.nome_loja}>
                        <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs hover:bg-muted/50">
                          <Checkbox checked={checked} onCheckedChange={() => toggle(l.nome_loja)} />
                          <span className="truncate">{l.nome_loja}</span>
                        </label>
                      </li>
                    );
                  })}
                  {filtradas.length === 0 && (
                    <li className="p-3 text-center text-[11px] text-muted-foreground">Nenhuma loja encontrada</li>
                  )}
                </ul>
              </ScrollArea>
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs">Assunto (opcional)</Label>
            <Input
              value={assunto}
              onChange={(e) => setAssunto(e.target.value.slice(0, 120))}
              placeholder="Ex.: Disponibilidade da armação X"
              className="h-9 text-sm"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Mensagem inicial</Label>
            <Textarea
              value={pergunta}
              onChange={(e) => setPergunta(e.target.value.slice(0, 2000))}
              placeholder="O que você precisa da(s) loja(s)?"
              rows={4}
              className="resize-none text-sm"
            />
            <p className="text-right text-[10px] text-muted-foreground">{pergunta.length}/2000</p>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Anexo (opcional)</Label>
            {anexo ? (
              <div className="flex items-center justify-between rounded-md border bg-muted/30 px-2 py-1.5 text-xs">
                <span className="flex items-center gap-1.5 truncate">
                  <Paperclip className="h-3 w-3 shrink-0" />
                  <span className="truncate">{anexo.name}</span>
                  <span className="shrink-0 text-muted-foreground">({Math.round(anexo.size / 1024)} KB)</span>
                </span>
                <Button type="button" variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => setAnexo(null)}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <Input
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f && f.size > 10 * 1024 * 1024) {
                    toast.error("Arquivo maior que 10MB");
                    return;
                  }
                  setAnexo(f ?? null);
                }}
                className="h-8 text-xs file:mr-2 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-[10px]"
              />
            )}
          </div>

          {grupo && selecionadas.size > 0 && (
            <div className="flex flex-wrap gap-1">
              {Array.from(selecionadas).slice(0, 8).map((n) => (
                <Badge key={n} variant="outline" className="text-[10px]">{n}</Badge>
              ))}
              {selecionadas.size > 8 && <Badge variant="outline" className="text-[10px]">+{selecionadas.size - 8}</Badge>}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={enviando}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={!podeEnviar || enviando}>
            {enviando && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            {grupo ? `Acionar ${selecionadas.size || ""} lojas` : "Acionar loja"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
