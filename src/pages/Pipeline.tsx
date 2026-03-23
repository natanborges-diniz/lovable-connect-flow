import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { useContatos, useUpdateContato } from "@/hooks/useContatos";
import { TipoContatoBadge } from "@/components/shared/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronRight, ChevronLeft, Phone, Mail, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { EstagioFunil } from "@/types/database";

const ESTAGIOS: { key: EstagioFunil; label: string; color: string }[] = [
  { key: "lead", label: "Lead", color: "border-t-muted-foreground" },
  { key: "qualificado", label: "Qualificado", color: "border-t-info" },
  { key: "proposta", label: "Proposta", color: "border-t-warning" },
  { key: "fechado", label: "Fechado", color: "border-t-success" },
];

const ESTAGIOS_KEYS = ESTAGIOS.map((e) => e.key);

export default function Pipeline() {
  const { data: contatos, isLoading } = useContatos();
  const updateContato = useUpdateContato();

  const contatosByEstagio = ESTAGIOS.map((estagio) => ({
    ...estagio,
    contatos: (contatos ?? []).filter((c) => c.estagio === estagio.key),
  }));

  const moverEstagio = (contatoId: string, direcao: "avancar" | "voltar") => {
    const contato = contatos?.find((c) => c.id === contatoId);
    if (!contato) return;
    const idx = ESTAGIOS_KEYS.indexOf(contato.estagio as EstagioFunil);
    const novoIdx = direcao === "avancar" ? idx + 1 : idx - 1;
    if (novoIdx < 0 || novoIdx >= ESTAGIOS_KEYS.length) return;
    updateContato.mutate({ id: contatoId, estagio: ESTAGIOS_KEYS[novoIdx] });
  };

  return (
    <>
      <PageHeader
        title="Pipeline de Vendas"
        description="Visualize e gerencie o funil de vendas dos seus contatos"
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Carregando...</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {contatosByEstagio.map((coluna) => (
            <div key={coluna.key} className="flex flex-col gap-3">
              <Card className={cn("border-t-4", coluna.color)}>
                <CardHeader className="pb-2 pt-4 px-4">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold">{coluna.label}</CardTitle>
                    <span className="text-xs font-medium bg-muted px-2 py-0.5 rounded-full text-muted-foreground">
                      {coluna.contatos.length}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="px-3 pb-3 space-y-2 max-h-[60vh] overflow-y-auto">
                  {coluna.contatos.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">Nenhum contato</p>
                  ) : (
                    coluna.contatos.map((contato) => {
                      const idx = ESTAGIOS_KEYS.indexOf(coluna.key);
                      return (
                        <Card key={contato.id} className="shadow-sm hover:shadow-md transition-shadow">
                          <CardContent className="p-3 space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="font-medium text-sm truncate">{contato.nome}</p>
                                <TipoContatoBadge tipo={contato.tipo} />
                              </div>
                            </div>

                            {(contato.telefone || contato.email) && (
                              <div className="space-y-1">
                                {contato.telefone && (
                                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                    <Phone className="h-3 w-3" />
                                    <span className="truncate">{contato.telefone}</span>
                                  </div>
                                )}
                                {contato.email && (
                                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                    <Mail className="h-3 w-3" />
                                    <span className="truncate">{contato.email}</span>
                                  </div>
                                )}
                              </div>
                            )}

                            {contato.ultimo_contato_at && (
                              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <Clock className="h-3 w-3" />
                                <span>
                                  {formatDistanceToNow(new Date(contato.ultimo_contato_at), {
                                    addSuffix: true,
                                    locale: ptBR,
                                  })}
                                </span>
                              </div>
                            )}

                            <div className="flex items-center justify-between pt-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                disabled={idx === 0 || updateContato.isPending}
                                onClick={() => moverEstagio(contato.id, "voltar")}
                              >
                                <ChevronLeft className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                disabled={idx === ESTAGIOS_KEYS.length - 1 || updateContato.isPending}
                                onClick={() => moverEstagio(contato.id, "avancar")}
                              >
                                <ChevronRight className="h-4 w-4" />
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })
                  )}
                </CardContent>
              </Card>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
