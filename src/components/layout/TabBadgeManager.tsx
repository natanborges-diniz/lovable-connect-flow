import { useEffect, useRef } from "react";
import { useUnreadTotal } from "@/hooks/useUnreadTotal";

/**
 * Sem UI. Reflete o total de não lidos em:
 * - document.title -> "(N) Título original"
 * - favicon -> versão com dot vermelho
 * - navigator.setAppBadge(N) quando suportado (Chrome desktop, PWA instalado)
 */
export function TabBadgeManager() {
  const { total } = useUnreadTotal();
  const baseTitleRef = useRef<string | null>(null);
  const baseFaviconRef = useRef<string | null>(null);

  // Captura título e favicon originais uma vez
  useEffect(() => {
    if (baseTitleRef.current === null) {
      const current = document.title || "";
      // Se já tem prefixo "(N) " por algum motivo, remove
      baseTitleRef.current = current.replace(/^\(\d+\)\s+/, "");
    }
    if (baseFaviconRef.current === null) {
      const link = document.querySelector<HTMLLinkElement>(
        'link[rel="icon"][type="image/png"]'
      );
      baseFaviconRef.current = link?.href ?? "/icons/icon-192.png";
    }
  }, []);

  // Atualiza título
  useEffect(() => {
    const base = baseTitleRef.current ?? document.title;
    document.title = total > 0 ? `(${total > 99 ? "99+" : total}) ${base}` : base;
  }, [total]);

  // Atualiza favicon (pinta pontinho vermelho quando total > 0)
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>(
      'link[rel="icon"][type="image/png"]'
    );
    if (!link) return;
    const base = baseFaviconRef.current ?? link.href;
    if (total > 0) {
      // Overlay via canvas em cima do favicon base
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const size = 64;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, size, size);
        // Dot
        ctx.beginPath();
        ctx.arc(size - 16, 16, 14, 0, Math.PI * 2);
        ctx.fillStyle = "#dc2626";
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 3;
        ctx.stroke();
        try {
          link.href = canvas.toDataURL("image/png");
        } catch {
          /* CORS bloqueou toDataURL, ignora */
        }
      };
      img.onerror = () => { /* ignora */ };
      img.src = base;
    } else {
      link.href = base;
    }
  }, [total]);

  // App badge (Chrome desktop / PWA)
  useEffect(() => {
    const nav = navigator as Navigator & {
      setAppBadge?: (n?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (total > 0 && typeof nav.setAppBadge === "function") {
      nav.setAppBadge(total).catch(() => {});
    } else if (typeof nav.clearAppBadge === "function") {
      nav.clearAppBadge().catch(() => {});
    }
  }, [total]);

  // Limpa ao desmontar
  useEffect(() => {
    return () => {
      if (baseTitleRef.current) document.title = baseTitleRef.current;
      const link = document.querySelector<HTMLLinkElement>(
        'link[rel="icon"][type="image/png"]'
      );
      if (link && baseFaviconRef.current) link.href = baseFaviconRef.current;
      const nav = navigator as Navigator & { clearAppBadge?: () => Promise<void> };
      nav.clearAppBadge?.().catch(() => {});
    };
  }, []);

  return null;
}
