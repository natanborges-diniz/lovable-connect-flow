import { useState, useEffect, useMemo } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Loader2, Search, Copy, ArrowDownToLine } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  atendimentoId: string;
  atendimentoMetadata?: any;
  contatoMetadata?: any;
  onInsertComposer: (text: string) => void;
}

type Modo = "oculos" | "lc" | "catalogo_livre";

interface RxEye { sphere?: number | null; cylinder?: number | null; axis?: number | null; add?: number | null }
interface Rx { eyes?: { od?: RxEye; oe?: RxEye }; rx_type?: string; label?: string }

function pickReceita(atMeta: any, ctMeta: any): Rx | null {
  const arr = Array.isArray(atMeta?.receitas) ? atMeta.receitas
    : Array.isArray(ctMeta?.receitas) ? ctMeta.receitas : null;
  if (arr?.length) return arr[arr.length - 1];
  if (ctMeta?.ultima_receita?.eyes) return ctMeta.ultima_receita;
  if (atMeta?.ultima_receita?.eyes) return atMeta.ultima_receita;
  return null;
}

const numOrNull = (v: string): number | null => {
  if (!v.trim()) return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

export function BuscarLentesSheet({ open, onOpenChange, atendimentoId, atendimentoMetadata, contatoMetadata, onInsertComposer }: Props) {
  const receitaSalva = useMemo(() => pickReceita(atendimentoMetadata, contatoMetadata), [atendimentoMetadata, contatoMetadata]);

  const [modo, setModo] = useState<Modo>("oculos");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  // OD/OE editáveis (override, não persiste)
  const [odSph, setOdSph] = useState("");
  const [odCyl, setOdCyl] = useState("");
  const [odAxis, setOdAxis] = useState("");
  const [odAdd, setOdAdd] = useState("");
  const [oeSph, setOeSph] = useState("");
  const [oeCyl, setOeCyl] = useState("");
  const [oeAxis, setOeAxis] = useState("");
  const [oeAdd, setOeAdd] = useState("");

  // Filtros
  const [marca, setMarca] = useState("");
  const [filtroBlue, setFiltroBlue] = useState(false);
  const [filtroPhoto, setFiltroPhoto] = useState(false);
  const [materialPC, setMaterialPC] = useState(false);
  const [descarte, setDescarte] = useState<"" | "diaria" | "quinzenal" | "mensal">("");
  const [precoMax, setPrecoMax] = useState("");
  const [queryNL, setQueryNL] = useState("");

  // Pré-carrega receita salva ao abrir
  useEffect(() => {
    if (!open) return;
    const od = receitaSalva?.eyes?.od || {};
    const oe = receitaSalva?.eyes?.oe || {};
    setOdSph(od.sphere != null ? String(od.sphere) : "");
    setOdCyl(od.cylinder != null ? String(od.cylinder) : "");
    setOdAxis(od.axis != null ? String(od.axis) : "");
    setOdAdd(od.add != null ? String(od.add) : "");
    setOeSph(oe.sphere != null ? String(oe.sphere) : "");
    setOeCyl(oe.cylinder != null ? String(oe.cylinder) : "");
    setOeAxis(oe.axis != null ? String(oe.axis) : "");
    setOeAdd(oe.add != null ? String(oe.add) : "");
    setResult(null);
  }, [open, receitaSalva]);

  const buscar = async () => {
    setLoading(true);
    try {
      const overrideHasData = [odSph, odCyl, oeSph, oeCyl, odAdd, oeAdd].some((v) => v.trim() !== "");
      const receita_override = overrideHasData ? {
        eyes: {
          od: { sphere: numOrNull(odSph), cylinder: numOrNull(odCyl), axis: numOrNull(odAxis), add: numOrNull(odAdd) },
          oe: { sphere: numOrNull(oeSph), cylinder: numOrNull(oeCyl), axis: numOrNull(oeAxis), add: numOrNull(oeAdd) },
        },
        rx_type: (numOrNull(odAdd) || numOrNull(oeAdd)) ? "progressive" : "single_vision",
      } : undefined;

      const filtros: any = {};
      if (marca.trim()) filtros.preferencia_marca = marca.trim();
      if (filtroBlue) filtros.filtro_blue = true;
      if (filtroPhoto) filtros.filtro_photo = true;
      if (materialPC) filtros.material_policarbonato = true;
      if (descarte) filtros.descarte = descarte;
      if (precoMax.trim()) filtros.preco_max = Number(precoMax.replace(",", "."));

      const { data, error } = await supabase.functions.invoke("buscar-lentes-operador", {
        body: {
          atendimento_id: atendimentoId,
          modo,
          query_natural: queryNL.trim() || undefined,
          filtros,
          receita_override,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setResult(data);
    } catch (e: any) {
      toast.error("Falha na busca: " + (e?.message || "erro"));
    } finally {
      setLoading(false);
    }
  };

  const copiarTexto = async (texto: string) => {
    if (!texto) return;
    await navigator.clipboard.writeText(texto);
    toast.success("Mensagem copiada");
  };

  const inserirTexto = (texto: string) => {
    if (!texto) return;
    onInsertComposer(texto);
    toast.success("Mensagem inserida no campo de envio — revise e envie");
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2"><Search className="h-4 w-4" /> Buscar lentes (copiloto)</SheetTitle>
        </SheetHeader>

        <Tabs value={modo} onValueChange={(v) => setModo(v as Modo)} className="mt-4">
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="oculos">Óculos</TabsTrigger>
            <TabsTrigger value="lc">Lentes de contato</TabsTrigger>
            <TabsTrigger value="catalogo_livre">Catálogo</TabsTrigger>
          </TabsList>

          {(modo === "oculos" || modo === "lc") && (
            <div className="mt-4 space-y-3">
              <div className="text-xs text-muted-foreground">
                {receitaSalva ? `Receita salva: ${receitaSalva.label || "última leitura"} (editável aqui sem alterar o salvo)` : "Sem receita salva — digite os valores abaixo"}
              </div>
              <div className="grid grid-cols-5 gap-2 items-end">
                <Label className="text-xs col-span-1">OD</Label>
                <div className="col-span-1"><Label className="text-[10px]">ESF</Label><Input value={odSph} onChange={(e) => setOdSph(e.target.value)} className="h-8" /></div>
                <div className="col-span-1"><Label className="text-[10px]">CIL</Label><Input value={odCyl} onChange={(e) => setOdCyl(e.target.value)} className="h-8" /></div>
                <div className="col-span-1"><Label className="text-[10px]">EIXO</Label><Input value={odAxis} onChange={(e) => setOdAxis(e.target.value)} className="h-8" /></div>
                <div className="col-span-1"><Label className="text-[10px]">ADD</Label><Input value={odAdd} onChange={(e) => setOdAdd(e.target.value)} className="h-8" /></div>
              </div>
              <div className="grid grid-cols-5 gap-2 items-end">
                <Label className="text-xs col-span-1">OE</Label>
                <div className="col-span-1"><Input value={oeSph} onChange={(e) => setOeSph(e.target.value)} className="h-8" /></div>
                <div className="col-span-1"><Input value={oeCyl} onChange={(e) => setOeCyl(e.target.value)} className="h-8" /></div>
                <div className="col-span-1"><Input value={oeAxis} onChange={(e) => setOeAxis(e.target.value)} className="h-8" /></div>
                <div className="col-span-1"><Input value={oeAdd} onChange={(e) => setOeAdd(e.target.value)} className="h-8" /></div>
              </div>
            </div>
          )}

          <div className="mt-4 space-y-3">
            <div>
              <Label className="text-xs">Instrução em linguagem natural (opcional)</Label>
              <Textarea
                placeholder='Ex.: "Varilux pra 3 peças com Crizal Sapphire", "diária tórica DNZ"'
                value={queryNL}
                onChange={(e) => setQueryNL(e.target.value)}
                rows={2}
                className="text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Marca</Label>
                <Input placeholder="Varilux, DNZ, DMAX…" value={marca} onChange={(e) => setMarca(e.target.value)} className="h-8" />
              </div>
              <div>
                <Label className="text-xs">Preço máx. (R$)</Label>
                <Input placeholder="3000" value={precoMax} onChange={(e) => setPrecoMax(e.target.value)} className="h-8" />
              </div>
            </div>

            {modo === "oculos" && (
              <div className="flex flex-wrap gap-3">
                <label className="flex items-center gap-2 text-xs"><Switch checked={filtroBlue} onCheckedChange={setFiltroBlue} /> Filtro azul</label>
                <label className="flex items-center gap-2 text-xs"><Switch checked={filtroPhoto} onCheckedChange={setFiltroPhoto} /> Fotossensível</label>
                <label className="flex items-center gap-2 text-xs"><Switch checked={materialPC} onCheckedChange={setMaterialPC} /> 3 peças (policarbonato)</label>
              </div>
            )}

            {modo === "lc" && (
              <div className="flex gap-2">
                {(["", "diaria", "quinzenal", "mensal"] as const).map((d) => (
                  <Button key={d || "all"} type="button" size="sm" variant={descarte === d ? "default" : "outline"} onClick={() => setDescarte(d)}>
                    {d || "Todos"}
                  </Button>
                ))}
              </div>
            )}

            <Button onClick={buscar} disabled={loading} className="w-full">
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
              Buscar
            </Button>
          </div>

          {result && (
            <div className="mt-6 space-y-4">
              {result.erro && (
                <div className="text-sm text-destructive bg-destructive/10 p-3 rounded">{result.erro}</div>
              )}

              {result.mensagem_formatada_cliente && (
                <div className="space-y-2">
                  <Label className="text-xs uppercase text-muted-foreground">Mensagem completa — 3 faixas (tom Gael / Óticas Diniz)</Label>
                  <Textarea
                    value={result.mensagem_formatada_cliente}
                    onChange={(e) => setResult({ ...result, mensagem_formatada_cliente: e.target.value })}
                    rows={Math.min(20, Math.max(6, result.mensagem_formatada_cliente.split("\n").length))}
                    className="text-sm font-mono"
                  />
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => copiarTexto(result.mensagem_formatada_cliente)}><Copy className="h-3 w-3 mr-1" /> Copiar</Button>
                    <Button size="sm" onClick={() => inserirTexto(result.mensagem_formatada_cliente)}><ArrowDownToLine className="h-3 w-3 mr-1" /> Inserir no campo de envio</Button>
                  </div>
                </div>
              )}

              {result.mensagens_por_faixa && Object.keys(result.mensagens_por_faixa).length > 0 && (
                <div className="space-y-2">
                  <Label className="text-xs uppercase text-muted-foreground">Enviar por faixa</Label>
                  {([
                    ["economica", "🟢 Econômica"],
                    ["intermediaria", "🟡 Intermediária"],
                    ["premium", "💎 Premium"],
                  ] as const).map(([key, label]) => {
                    const texto = result.mensagens_por_faixa?.[key];
                    if (!texto) return null;
                    return (
                      <div key={key} className="border rounded-md p-2 space-y-2 bg-muted/30">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium">{label}</span>
                          <div className="flex gap-1">
                            <Button size="sm" variant="outline" onClick={() => copiarTexto(texto)}><Copy className="h-3 w-3 mr-1" /> Copiar</Button>
                            <Button size="sm" onClick={() => inserirTexto(texto)}><ArrowDownToLine className="h-3 w-3 mr-1" /> Inserir</Button>
                          </div>
                        </div>
                        <Textarea
                          value={texto}
                          onChange={(e) => setResult({
                            ...result,
                            mensagens_por_faixa: { ...result.mensagens_por_faixa, [key]: e.target.value },
                          })}
                          rows={Math.min(10, Math.max(4, texto.split("\n").length))}
                          className="text-xs font-mono"
                        />
                      </div>
                    );
                  })}
                </div>
              )}

              {result.alternativas?.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-xs text-muted-foreground">Ver {result.alternativas.length} alternativas no catálogo</summary>
                  <div className="mt-2 space-y-1 max-h-64 overflow-y-auto">
                    {result.alternativas.map((a: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-xs py-1 border-b">
                        <span>{a.brand || a.fornecedor} {a.family || a.produto} {a.treatment || a.descarte}</span>
                        <Badge variant="outline">R$ {Number(a.price_brl || a.price_caixa).toFixed(2)}</Badge>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
