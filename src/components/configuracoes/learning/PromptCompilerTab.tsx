import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Wand2, Loader2, CheckCircle2, AlertTriangle, History, RefreshCw } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

function useCompiledPrompt() {
  return useQuery({
    queryKey: ["prompt_compilado"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("configuracoes_ia")
        .select("chave, valor, updated_at")
        .in("chave", ["prompt_compilado", "prompt_compilado_at", "prompt_compilado_fontes", "prompt_versoes"]);
      if (error) throw error;

      const map: Record<string, any> = {};
      for (const row of data || []) {
        map[row.chave] = row;
      }
      return map;
    },
  });
}

export function PromptCompilerTab() {
  const { data: configs, isLoading } = useCompiledPrompt();
  const [compiling, setCompiling] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [validationError, setValidationError] = useState<string[] | null>(null);
  const queryClient = useQueryClient();

  const compiledPrompt = configs?.prompt_compilado?.valor || "";
  const compiledAt = configs?.prompt_compilado_at?.valor || "";
  const fontesRaw = configs?.prompt_compilado_fontes?.valor;
  const versionsRaw = configs?.prompt_versoes?.valor;

  let fontes: any = null;
  try { fontes = fontesRaw ? JSON.parse(fontesRaw) : null; } catch { fontes = null; }

  let versions: any[] = [];
  try { versions = versionsRaw ? JSON.parse(versionsRaw) : []; } catch { versions = []; }

  const handleCompile = async () => {
    setCompiling(true);
    setValidationError(null);
    try {
      const { data, error } = await supabase.functions.invoke("compile-prompt", {
        body: {},
      });

      if (error) throw error;

      if (data?.error && data?.missing) {
        setValidationError(data.missing);
        toast.error("Validação falhou — termos obrigatórios ausentes no resultado");
        return;
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      queryClient.invalidateQueries({ queryKey: ["prompt_compilado"] });
      toast.success(`Prompt compilado com sucesso! (${data.compiled_length} caracteres)`);
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    } finally {
      setCompiling(false);
    }
  };

  const handleRollback = async (version: any) => {
    try {
      const { error } = await supabase
        .from("configuracoes_ia")
        .update({ valor: version.prompt, updated_at: new Date().toISOString() })
        .eq("chave", "prompt_compilado");
      if (error) throw error;

      await supabase
        .from("configuracoes_ia")
        .update({ valor: version.compiled_at, updated_at: new Date().toISOString() })
        .eq("chave", "prompt_compilado_at");

      queryClient.invalidateQueries({ queryKey: ["prompt_compilado"] });
      toast.success("Rollback realizado!");
      setShowVersions(false);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Status and actions */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            O compilador usa IA para fundir o prompt base + exemplos + feedbacks em um prompt unificado e otimizado.
          </p>
          <p className="text-[10px] text-muted-foreground">
            ⚠️ Proibições são injetadas literalmente (nunca reescritas pela IA).
          </p>
        </div>
        <div className="flex items-center gap-2">
          {versions.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowVersions(!showVersions)}
              className="text-xs"
            >
              <History className="h-3.5 w-3.5 mr-1" />
              Histórico ({versions.length})
            </Button>
          )}
          <Button
            size="sm"
            onClick={handleCompile}
            disabled={compiling}
          >
            {compiling ? (
              <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Compilando...</>
            ) : (
              <><Wand2 className="h-3.5 w-3.5 mr-1" /> Recompilar Prompt</>
            )}
          </Button>
        </div>
      </div>

      {/* Validation error */}
      {validationError && (
        <div className="border border-destructive/30 bg-destructive/5 rounded-lg p-3 text-xs space-y-1">
          <div className="flex items-center gap-1 text-destructive font-medium">
            <AlertTriangle className="h-3.5 w-3.5" />
            Validação falhou — termos obrigatórios ausentes:
          </div>
          <ul className="list-disc pl-5 text-destructive/80">
            {validationError.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
        </div>
      )}

      {/* Status badges */}
      {compiledPrompt ? (
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-700 border-green-500/30">
            <CheckCircle2 className="h-3 w-3 mr-1" /> Compilado
          </Badge>
          {compiledAt && (
            <Badge variant="outline" className="text-[10px]">
              {new Date(compiledAt).toLocaleString("pt-BR")}
            </Badge>
          )}
          {fontes && (
            <>
              <Badge variant="outline" className="text-[10px]">
                {fontes.exemplos} exemplos
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                {fontes.feedbacks} feedbacks
              </Badge>
            </>
          )}
          <Badge variant="outline" className="text-[10px]">
            {compiledPrompt.length} caracteres
          </Badge>
        </div>
      ) : (
        <div className="border border-dashed rounded-lg p-6 text-center space-y-2">
          <Wand2 className="h-8 w-8 mx-auto text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">Nenhum prompt compilado ainda.</p>
          <p className="text-xs text-muted-foreground">
            Clique em "Recompilar Prompt" para gerar a primeira versão unificada.
          </p>
        </div>
      )}

      {/* Version history */}
      {showVersions && versions.length > 0 && (
        <div className="border rounded-lg p-3 space-y-2">
          <p className="text-xs font-medium">Versões anteriores</p>
          {versions.map((v: any, i: number) => (
            <div key={i} className="flex items-center justify-between text-xs border-b pb-2 last:border-0">
              <div className="space-y-0.5">
                <p className="text-muted-foreground">
                  {new Date(v.compiled_at).toLocaleString("pt-BR")}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {v.fontes?.exemplos || 0} exemplos, {v.fontes?.feedbacks || 0} feedbacks — {v.prompt?.length || 0} chars
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-7"
                onClick={() => handleRollback(v)}
              >
                <RefreshCw className="h-3 w-3 mr-1" /> Restaurar
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Compiled prompt preview */}
      {compiledPrompt && (
        <>
          <Separator />
          <div className="space-y-2">
            <p className="text-xs font-medium">Preview do Prompt Compilado</p>
            <ScrollArea className="h-[300px] border rounded-lg p-3">
              <pre className="text-xs whitespace-pre-wrap font-mono text-muted-foreground leading-relaxed">
                {compiledPrompt}
              </pre>
            </ScrollArea>
          </div>
        </>
      )}
    </div>
  );
}
