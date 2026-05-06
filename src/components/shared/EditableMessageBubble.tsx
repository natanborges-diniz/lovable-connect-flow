import { useState, useEffect, useRef } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Check, X, Loader2 } from "lucide-react";

interface Props {
  initialValue: string;
  onCancel: () => void;
  onSave: (value: string) => Promise<void> | void;
  saving?: boolean;
}

/** Editor inline mostrado dentro de uma bolha quando a msg está em edição. */
export function EditableMessageBubble({ initialValue, onCancel, onSave, saving }: Props) {
  const [value, setValue] = useState(initialValue);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.setSelectionRange(value.length, value.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canSave = value.trim().length > 0 && value.trim() !== initialValue.trim();

  return (
    <div className="space-y-1.5">
      <Textarea
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (canSave) void onSave(value.trim());
          }
        }}
        rows={2}
        className="min-h-[3rem] resize-none bg-background text-foreground text-sm"
      />
      <div className="flex items-center justify-end gap-1">
        <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={onCancel} disabled={saving}>
          <X className="h-3 w-3 mr-1" /> Cancelar
        </Button>
        <Button
          size="sm"
          className="h-6 text-[11px]"
          onClick={() => canSave && void onSave(value.trim())}
          disabled={!canSave || saving}
        >
          {saving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Check className="h-3 w-3 mr-1" />}
          Salvar
        </Button>
      </div>
    </div>
  );
}
