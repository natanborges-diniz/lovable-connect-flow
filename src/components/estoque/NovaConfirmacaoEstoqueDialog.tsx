import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Upload, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLojas } from "@/hooks/useLojas";
import { useCreateConfirmacaoEstoque } from "@/hooks/useConfirmacoesEstoque";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function NovaConfirmacaoEstoqueDialog({ open, onOpenChange }: Props) {
  const { data: lojas = [] } = useLojas();
  const create = useCreateConfirmacaoEstoque();

  const [referencia, setReferencia] = useState("");
  const [codigo, setCodigo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [observacao, setObservacao] = useState("");
  const [fotoUrl, setFotoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const reset = () => {
    setReferencia(""); setCodigo(""); setDescricao(""); setObservacao("");
    setFotoUrl(null); setSelected(new Set()); setSearch("");
  };

  const handleClose = (v: boolean) => { if (!v) reset(); onOpenChange(v); };

  const handleUpload = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) { toast.error("Máx 5MB"); return; }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${new Date().getFullYear()}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("estoque-confirmacoes").upload(path, file, { upsert: false });
      if (error) throw error;
      const { data } = supabase.storage.from("estoque-confirmacoes").getPublicUrl(path);
      setFotoUrl(data.publicUrl);
    } catch (e: any) {
      toast.error("Falha no upload: " + (e?.message || "erro"));
    } finally {
      setUploading(false);
    }
  };

  const toggleLoja = (nome: string) => {
    const next = new Set(selected);
    next.has(nome) ? next.delete(nome) : next.add(nome);
    setSelected(next);
  };

  const filteredLojas = lojas.filter(l => l.nome_loja.toLowerCase().includes(search.toLowerCase()));

  const submit = async () => {
    if (!referencia.trim() || !codigo.trim()) { toast.error("Referência e código são obrigatórios"); return; }
    if (selected.size === 0) { toast.error("Selecione ao menos 1 loja"); return; }

    const lojasPayload = lojas
      .filter(l => selected.has(l.nome_loja))
      .map(l => ({ nome_loja: l.nome_loja, telefone: l.telefone }));

    await create.mutateAsync({
      referencia: referencia.trim(),
      codigo_produto: codigo.trim(),
      descricao_peca: descricao.trim() || null,
      observacao_estoque: observacao.trim() || null,
      foto_url: fotoUrl,
      lojas: lojasPayload,
    });
    handleClose(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nova solicitação de confirmação de peça</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ref">Referência *</Label>
              <Input id="ref" value={referencia} onChange={e => setReferencia(e.target.value)} placeholder="ex: AR-1234" />
            </div>
            <div>
              <Label htmlFor="cod">Código *</Label>
              <Input id="cod" value={codigo} onChange={e => setCodigo(e.target.value)} placeholder="ex: 78910" />
            </div>
          </div>

          <div>
            <Label htmlFor="desc">Descrição (opcional)</Label>
            <Input id="desc" value={descricao} onChange={e => setDescricao(e.target.value)} placeholder="cor / modelo / tamanho" maxLength={300} />
          </div>

          <div>
            <Label htmlFor="obs">Observação (opcional)</Label>
            <Textarea id="obs" value={observacao} onChange={e => setObservacao(e.target.value)} rows={2} maxLength={500} placeholder="contexto p/ a loja" />
          </div>

          <div>
            <Label>Foto da peça (opcional, máx 5MB)</Label>
            <div className="flex items-center gap-2 mt-1">
              <Input type="file" accept="image/*" disabled={uploading}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(f); }} />
              {uploading && <Loader2 className="h-4 w-4 animate-spin" />}
              {fotoUrl && (
                <div className="flex items-center gap-2">
                  <img src={fotoUrl} alt="prévia" className="h-12 w-12 rounded object-cover border" />
                  <Button size="icon" variant="ghost" onClick={() => setFotoUrl(null)}><X className="h-4 w-4" /></Button>
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <Label>Lojas destino *</Label>
              <Badge variant="outline" className="text-xs">{selected.size} selecionada(s)</Badge>
            </div>
            <Input placeholder="Filtrar loja..." value={search} onChange={e => setSearch(e.target.value)} className="h-8 mb-1" />
            <ScrollArea className="h-44 rounded border">
              <ul className="divide-y">
                {filteredLojas.map(l => (
                  <li key={l.nome_loja} className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted/40">
                    <Checkbox checked={selected.has(l.nome_loja)} onCheckedChange={() => toggleLoja(l.nome_loja)} />
                    <span className="text-sm truncate">{l.nome_loja}</span>
                  </li>
                ))}
                {filteredLojas.length === 0 && <li className="px-2 py-2 text-xs text-muted-foreground">Nenhuma loja</li>}
              </ul>
            </ScrollArea>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => handleClose(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={create.isPending || uploading}>
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
            Enviar para {selected.size} loja(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
