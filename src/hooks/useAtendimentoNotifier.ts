// Notificador in-app de novas mensagens de atendimento humano.
// - Toast (sonner) com ação "Abrir" → navega para /crm/conversas?open={atendimento_id}
// - Sinal sonoro leve via WebAudio (sem asset)
// - Só dispara para o usuário logado (RLS já garante via notificacoes.usuario_id)
// - Push de background continua sendo entregue pelo Service Worker

import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

const TIPOS_ALVO = new Set(["atendimento_humano", "atendimento_inbound"]);

function playBeep() {
  try {
    const Ctx =
      (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
        .AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.36);
    osc.onended = () => ctx.close().catch(() => {});
  } catch {
    /* silencioso */
  }
}

export function useAtendimentoNotifier() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`notif-toast-${user.id}`)
      .on(
        "postgres_changes" as never,
        {
          event: "INSERT",
          schema: "public",
          table: "notificacoes",
          filter: `usuario_id=eq.${user.id}`,
        },
        (payload: { new: Record<string, unknown> }) => {
          const n = payload.new as {
            id: string;
            tipo: string;
            titulo?: string | null;
            mensagem?: string | null;
            referencia_id?: string | null;
          };
          if (!TIPOS_ALVO.has(n.tipo)) return;
          if (seenRef.current.has(n.id)) return;
          seenRef.current.add(n.id);

          playBeep();

          const atendimentoId = n.referencia_id ?? null;
          toast(n.titulo || "Nova mensagem", {
            description: n.mensagem || undefined,
            action: atendimentoId
              ? {
                  label: "Abrir",
                  onClick: () => navigate(`/crm/conversas?open=${atendimentoId}`),
                }
              : undefined,
            duration: 8000,
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, navigate]);
}
