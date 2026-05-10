import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Catálogo simples (nome → body) dos templates WhatsApp aprovados/locais.
 * Usado para renderizar mensagens armazenadas como `[Template: NOME] Params: ...`
 * com o texto que o cliente realmente recebeu.
 */
export function useWhatsappTemplates() {
  return useQuery({
    queryKey: ["whatsapp-templates", "render-catalog"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_templates")
        .select("nome, body");
      if (error) throw error;
      const map = new Map<string, string>();
      for (const t of data ?? []) {
        if (t.nome && t.body) map.set(t.nome, t.body);
      }
      return map;
    },
  });
}
