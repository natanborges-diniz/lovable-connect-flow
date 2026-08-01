import { supabase } from "@/integrations/supabase/client";

/**
 * Rede/sessão podem pendurar a promise do storage (upload travado, token expirado).
 * Sem um teto de tempo o spinner de "anexando" fica girando para sempre — foi o que
 * quebrou o anexo no layout novo. Todo upload da aplicação passa por aqui.
 */
export const UPLOAD_TIMEOUT_MS = 60000;

export async function withTimeout<T>(p: PromiseLike<T>, ms = UPLOAD_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(p),
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("tempo esgotado (verifique sua conexão e tente novamente)")),
          ms
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type UploadOptions = { contentType?: string; upsert?: boolean; timeoutMs?: number };

/** Upload com teto de tempo. Lança erro legível em vez de travar a UI. */
export async function uploadFile(
  bucket: string,
  path: string,
  file: File,
  options: UploadOptions = {}
): Promise<{ path: string; publicUrl: string }> {
  const { timeoutMs, ...rest } = options;
  const { error } = await withTimeout(
    supabase.storage.from(bucket).upload(path, file, {
      contentType: options.contentType ?? file.type,
      ...rest,
    }),
    timeoutMs
  );
  if (error) throw error;
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return { path, publicUrl: data.publicUrl };
}
