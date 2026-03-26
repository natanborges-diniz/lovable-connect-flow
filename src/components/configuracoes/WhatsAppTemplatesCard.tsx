import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Plus, RefreshCw, Trash2, Loader2, MessageSquare, ChevronDown, Eye } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface MetaTemplate {
  name: string;
  status: string;
  category: string;
  language: string;
  id: string;
  components?: any[];
}

function useTemplates() {
  return useQuery({
    queryKey: ["whatsapp-templates"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("manage-whatsapp-templates", {
        body: { action: "list" },
      });
      if (error) throw error;
      return (data?.data || []) as MetaTemplate[];
    },
  });
}

const statusColors: Record<string, string> = {
  APPROVED: "bg-success-soft text-success",
  PENDING: "bg-warning-soft text-warning",
  REJECTED: "bg-destructive/10 text-destructive",
};

function getComponentText(template: MetaTemplate, type: string): string | null {
  const comp = template.components?.find((c: any) => c.type === type);
  return comp?.text || null;
}

function TemplatePreview({ template }: { template: MetaTemplate }) {
  const header = getComponentText(template, "HEADER");
  const body = getComponentText(template, "BODY");
  const footer = getComponentText(template, "FOOTER");
  const buttons = template.components?.find((c: any) => c.type === "BUTTONS");

  return (
    <div className="bg-muted/50 rounded-lg p-4 space-y-2 border border-border">
      {header && (
        <p className="font-semibold text-sm text-foreground">{header}</p>
      )}
      {body && (
        <p className="text-sm text-foreground whitespace-pre-wrap">{body}</p>
      )}
      {footer && (
        <p className="text-xs text-muted-foreground mt-2">{footer}</p>
      )}
      {buttons?.buttons && (
        <div className="flex flex-wrap gap-2 pt-2 border-t border-border mt-2">
          {buttons.buttons.map((btn: any, i: number) => (
            <span key={i} className="text-xs bg-primary/10 text-primary px-3 py-1 rounded-full">
              {btn.text}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function WhatsAppTemplatesCard() {
  const { data: templates, isLoading, refetch, isRefetching } = useTemplates();
  const [createDialog, setCreateDialog] = useState(false);
  const [expandedTemplate, setExpandedTemplate] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await supabase.functions.invoke("manage-whatsapp-templates", {
        body: { action: "delete", template_name: name },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-templates"] });
      toast.success("Template excluído");
    },
    onError: (e) => toast.error("Erro: " + e.message),
  });

  return (
    <Card className="shadow-card">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg flex items-center gap-2">
          <MessageSquare className="h-5 w-5" /> Templates WhatsApp (Meta)
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isRefetching}>
            <RefreshCw className={`h-4 w-4 mr-1 ${isRefetching ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Dialog open={createDialog} onOpenChange={setCreateDialog}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" /> Novo Template
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Criar Template</DialogTitle>
              </DialogHeader>
              <CreateTemplateForm
                onSuccess={() => {
                  setCreateDialog(false);
                  queryClient.invalidateQueries({ queryKey: ["whatsapp-templates"] });
                }}
              />
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !templates?.length ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Nenhum template encontrado</p>
        ) : (
          <div className="space-y-2">
            {templates.map((t) => (
              <Collapsible
                key={t.id}
                open={expandedTemplate === t.id}
                onOpenChange={(open) => setExpandedTemplate(open ? t.id : null)}
              >
                <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-card hover:bg-muted/30 transition-colors">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                        <ChevronDown className={`h-4 w-4 transition-transform ${expandedTemplate === t.id ? "rotate-180" : ""}`} />
                      </Button>
                    </CollapsibleTrigger>
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-sm font-medium truncate">{t.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground">{t.category}</span>
                        <span className="text-xs text-muted-foreground">•</span>
                        <span className="text-xs text-muted-foreground">{t.language}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className={statusColors[t.status] || "bg-muted text-muted-foreground"}>
                      {t.status}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      onClick={() => {
                        if (confirm(`Excluir template "${t.name}"?`)) {
                          deleteMutation.mutate(t.name);
                        }
                      }}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <CollapsibleContent className="pl-12 pr-3 pb-2 pt-1">
                  {t.components?.length ? (
                    <TemplatePreview template={t} />
                  ) : (
                    <p className="text-xs text-muted-foreground italic py-2">Sem conteúdo disponível</p>
                  )}
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CreateTemplateForm({ onSuccess }: { onSuccess: () => void }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("UTILITY");
  const [headerText, setHeaderText] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [footerText, setFooterText] = useState("");
  const [loading, setLoading] = useState(false);

  // Live preview state
  const previewTemplate: MetaTemplate = {
    name: name || "preview",
    status: "PREVIEW",
    category,
    language: "pt_BR",
    id: "preview",
    components: [
      ...(headerText.trim() ? [{ type: "HEADER", format: "TEXT", text: headerText }] : []),
      { type: "BODY", text: bodyText || "Corpo da mensagem..." },
      ...(footerText.trim() ? [{ type: "FOOTER", text: footerText }] : []),
    ],
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const components: any[] = [];
      if (headerText.trim()) {
        components.push({ type: "HEADER", format: "TEXT", text: headerText });
      }
      components.push({ type: "BODY", text: bodyText });
      if (footerText.trim()) {
        components.push({ type: "FOOTER", text: footerText });
      }

      const template_data = {
        name: name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, ""),
        language: "pt_BR",
        category,
        components,
      };

      const { error } = await supabase.functions.invoke("manage-whatsapp-templates", {
        body: { action: "create", template_data },
      });
      if (error) throw error;
      toast.success("Template enviado para aprovação da Meta!");
      onSuccess();
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Nome do Template *</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ex: confirmacao_agendamento"
          required
        />
        <p className="text-xs text-muted-foreground">Apenas letras minúsculas, números e underscores</p>
      </div>
      <div className="space-y-2">
        <Label>Categoria</Label>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="UTILITY">Utilitária</SelectItem>
            <SelectItem value="MARKETING">Marketing</SelectItem>
            <SelectItem value="AUTHENTICATION">Autenticação</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Cabeçalho (opcional)</Label>
        <Input value={headerText} onChange={(e) => setHeaderText(e.target.value)} placeholder="Texto do cabeçalho" />
      </div>
      <div className="space-y-2">
        <Label>Corpo da Mensagem *</Label>
        <Textarea
          value={bodyText}
          onChange={(e) => setBodyText(e.target.value)}
          rows={4}
          required
          placeholder="Use {{1}}, {{2}} para variáveis dinâmicas"
        />
      </div>
      <div className="space-y-2">
        <Label>Rodapé (opcional)</Label>
        <Input value={footerText} onChange={(e) => setFooterText(e.target.value)} placeholder="Texto do rodapé" />
      </div>

      {/* Live Preview */}
      <div className="space-y-2">
        <Label className="flex items-center gap-1.5">
          <Eye className="h-3.5 w-3.5" /> Pré-visualização
        </Label>
        <TemplatePreview template={previewTemplate} />
      </div>

      <Button type="submit" className="w-full" disabled={loading || !name || !bodyText}>
        {loading ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Enviando...</> : "Criar e Enviar para Aprovação"}
      </Button>
    </form>
  );
}
