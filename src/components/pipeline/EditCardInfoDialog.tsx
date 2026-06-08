import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export type EditableField = {
  key: string;
  label: string;
  type: "text" | "textarea";
  value: string | null | undefined;
  placeholder?: string;
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  table: "solicitacoes" | "confirmacoes_estoque";
  rowId: string;
  fields: EditableField[];
  invalidateKeys: string[][];
  title?: string;
}

export function EditCardInfoDialog({
  open,
  onOpenChange,
  table,
  rowId,
  fields,
  invalidateKeys,
  title = "Editar informações do card",
}: Props) {
  const qc = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      const init: Record<string, string> = {};
      for (const f of fields) init[f.key] = f.value ?? "";
      setValues(init);
    }
  }, [open, fields]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const patch: Record<string, any> = {};
      for (const f of fields) {
        const v = (values[f.key] ?? "").trim();
        patch[f.key] = v.length === 0 ? null : v;
      }
      const { error } = await (supabase.from(table) as any).update(patch).eq("id", rowId);
      if (error) throw error;
      toast.success("Card atualizado");
      invalidateKeys.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao atualizar card");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-xs">
            Edição administrativa — alterações ficam registradas no card.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {fields.map((f) => (
            <div key={f.key} className="space-y-1">
              <Label className="text-xs">{f.label}</Label>
              {f.type === "textarea" ? (
                <Textarea
                  rows={4}
                  value={values[f.key] ?? ""}
                  placeholder={f.placeholder}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              ) : (
                <Input
                  value={values[f.key] ?? ""}
                  placeholder={f.placeholder}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              )}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
