import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Contato, TipoContato } from "@/types/database";
import { toast } from "sonner";

export function useContatos(filters?: { tipo?: TipoContato; search?: string }) {
  return useQuery({
    queryKey: ["contatos", filters],
    queryFn: async () => {
      let query = supabase.from("contatos").select("*").order("created_at", { ascending: false });
      if (filters?.tipo) query = query.eq("tipo", filters.tipo);
      if (filters?.search) query = query.or(`nome.ilike.%${filters.search}%,email.ilike.%${filters.search}%,telefone.ilike.%${filters.search}%`);
      const { data, error } = await query;
      if (error) throw error;
      return data as Contato[];
    },
  });
}

export function useContato(id: string | undefined) {
  return useQuery({
    queryKey: ["contato", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("contatos").select("*").eq("id", id!).single();
      if (error) throw error;
      return data as Contato;
    },
  });
}

export function useCreateContato() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (contato: Omit<Contato, "id" | "created_at" | "updated_at">) => {
      const { data, error } = await supabase.from("contatos").insert(contato).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contatos"] });
      toast.success("Contato criado com sucesso");
    },
    onError: (error) => {
      toast.error("Erro ao criar contato: " + error.message);
    },
  });
}

export function useUpdateContato() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Contato> & { id: string }) => {
      const { data, error } = await supabase.from("contatos").update(updates).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["contatos"] });
      queryClient.invalidateQueries({ queryKey: ["contato", data.id] });
      toast.success("Contato atualizado");
    },
    onError: (error) => {
      toast.error("Erro ao atualizar: " + error.message);
    },
  });
}
