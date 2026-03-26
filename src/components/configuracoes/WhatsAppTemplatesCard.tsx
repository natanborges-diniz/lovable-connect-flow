import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, RefreshCw, Trash2, Loader2, MessageSquare } from "lucide-react";
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

export function WhatsAppTemplatesCard() {
  const { data: templates, isLoading, refetch, isRefetching } = useTemplates();
  const [createDialog, setCreateDialog] = useState(false);
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
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Idioma</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-sm">{t.name}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{t.category}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{t.language}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusColors[t.status] || "bg-muted text-muted-foreground"}>
                        {t.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
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
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
      <Button type="submit" className="w-full" disabled={loading || !name || !bodyText}>
        {loading ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Enviando...</> : "Criar e Enviar para Aprovação"}
      </Button>
    </form>
  );
}
