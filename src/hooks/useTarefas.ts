import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { StatusTarefa, Prioridade } from "@/types/database";

export function useTarefas(filters?: { status?: StatusTarefa; search?: string }) {
  return useQuery({
    queryKey: ["tarefas", filters],
    queryFn: async () => {
      let query = supabase
        .from("tarefas")
        .select("*, solicitacao:solicitacoes(id, assunto), fila:filas(id, nome, setor:setores(id, nome))")
        .order("created_at", { ascending: false });
      if (filters?.status) query = query.eq("status", filters.status);
      if (filters?.search) query = query.ilike("titulo", `%${filters.search}%`);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useTarefa(id: string | undefined) {
  return useQuery({
    queryKey: ["tarefa", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tarefas")
        .select("*, solicitacao:solicitacoes(*, contato:contatos(id, nome, tipo)), fila:filas(*, setor:setores(*))")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateTarefa() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (tarefa: {
      titulo: string;
      descricao?: string | null;
      solicitacao_id?: string | null;
      fila_id?: string | null;
      prioridade?: Prioridade;
      responsavel_nome?: string | null;
      prazo_at?: string | null;
    }) => {
      const { data, error } = await supabase
        .from("tarefas")
        .insert({
          titulo: tarefa.titulo,
          descricao: tarefa.descricao ?? null,
          solicitacao_id: tarefa.solicitacao_id ?? null,
          fila_id: tarefa.fila_id ?? null,
          prioridade: tarefa.prioridade ?? "normal",
          responsavel_nome: tarefa.responsavel_nome ?? null,
          prazo_at: tarefa.prazo_at ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tarefas"] });
      toast.success("Tarefa criada com sucesso");
    },
    onError: (error) => {
      toast.error("Erro ao criar tarefa: " + error.message);
    },
  });
}

export function useUpdateTarefaStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: StatusTarefa }) => {
      const updates: { status: StatusTarefa; concluida_at?: string } = { status };
      if (status === "concluida") updates.concluida_at = new Date().toISOString();
      const { data, error } = await supabase.from("tarefas").update(updates).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["tarefas"] });
      queryClient.invalidateQueries({ queryKey: ["tarefa", data.id] });
      toast.success("Status da tarefa atualizado");
    },
    onError: (error) => {
      toast.error("Erro ao atualizar: " + error.message);
    },
  });
}

export function useChecklistItems(tarefaId: string | undefined) {
  return useQuery({
    queryKey: ["checklist", tarefaId],
    enabled: !!tarefaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("checklist_items")
        .select("*")
        .eq("tarefa_id", tarefaId!)
        .order("ordem", { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateChecklistItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (item: { tarefa_id: string; titulo: string; ordem?: number }) => {
      const { data, error } = await supabase.from("checklist_items").insert(item).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["checklist", data.tarefa_id] });
    },
    onError: (error) => {
      toast.error("Erro ao adicionar item: " + error.message);
    },
  });
}

export function useToggleChecklistItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, concluido, tarefa_id }: { id: string; concluido: boolean; tarefa_id: string }) => {
      const { data, error } = await supabase
        .from("checklist_items")
        .update({ concluido })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return { ...data, tarefa_id };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["checklist", data.tarefa_id] });
    },
    onError: (error) => {
      toast.error("Erro ao atualizar item: " + error.message);
    },
  });
}
