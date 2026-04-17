import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const FN_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/recuperar-atendimentos`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

async function callFn(method: "GET" | "POST", qs?: string, body?: unknown) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? ANON_KEY;
  const url = qs ? `${FN_BASE}?${qs}` : FN_BASE;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
  return json;
}

export interface OrfaoRow {
  atendimento_id: string;
  contato_id: string;
  contato_nome: string | null;
  contato_telefone: string | null;
  modo: string;
  status: string;
  ultima_mensagem_at: string;
  ultima_mensagem_conteudo: string;
  setor_id: string | null;
  setor_nome: string | null;
  minutos_pendente: number;
}

export type PublicoFiltro = "clientes" | "internos" | "todos";

export function useAtendimentosOrfaos(filtros: {
  idade_min: number;
  setor_id?: string;
  modo?: string;
  publico?: PublicoFiltro;
}) {
  return useQuery({
    queryKey: [
      "atendimentos-orfaos",
      filtros.idade_min,
      filtros.publico ?? "todos",
      filtros.setor_id ?? "",
      filtros.modo ?? "",
    ],
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<{
      total: number;
      orfaos: OrfaoRow[];
      por_publico: { clientes: number; internos: number };
    }> => {
      const params = new URLSearchParams({
        action: "list",
        idade_min: String(filtros.idade_min),
      });
      if (filtros.setor_id) params.set("setor_id", filtros.setor_id);
      if (filtros.modo) params.set("modo", filtros.modo);
      if (filtros.publico) params.set("publico", filtros.publico);
      return await callFn("GET", params.toString());
    },
  });
}

export function useRecuperarAtendimentos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      acao: "acionar_ia" | "escalar_humano" | "mensagem_desculpas" | "lote_inteligente";
      atendimento_ids: string[];
      mensagem?: string;
    }) => {
      if (!payload.atendimento_ids?.length) {
        throw new Error("Nenhum atendimento selecionado");
      }
      console.log("[recuperar] enviando", { acao: payload.acao, qtd: payload.atendimento_ids.length });
      return await callFn("POST", undefined, payload);
    },
    onSuccess: (data: any) => {
      console.log("[recuperar] resposta", data);
      const results = data?.results || [];
      const ok = results.filter((r: any) => r.ok).length;
      const fail = results.length - ok;
      if (results.length === 0) {
        toast.error("Nenhum atendimento processado — verifique a seleção");
      } else if (fail === 0) {
        toast.success(`${ok} atendimento(s) recuperados com sucesso`);
      } else {
        toast.warning(`${ok} ok, ${fail} falharam — veja o console`);
      }
      qc.invalidateQueries({ queryKey: ["atendimentos-orfaos"] });
      qc.invalidateQueries({ queryKey: ["atendimentos"] });
    },
    onError: (e: any) => {
      console.error("[recuperar] erro", e);
      toast.error("Erro: " + e.message);
    },
  });
}
