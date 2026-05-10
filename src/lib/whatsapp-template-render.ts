/**
 * Helpers para renderizar mensagens armazenadas no formato técnico
 *   `[Template: NOME] Params: v1, v2, ...`
 * como o cliente final viu no WhatsApp.
 */

export interface ParsedTemplateMessage {
  name: string;
  params: string[];
}

const TEMPLATE_RE = /^\[Template:\s*([^\]]+)\]\s*(?:Params:\s*(.*))?$/s;

export function parseTemplateMessage(conteudo: string | null | undefined): ParsedTemplateMessage | null {
  if (!conteudo) return null;
  const trimmed = conteudo.trim();
  const m = trimmed.match(TEMPLATE_RE);
  if (!m) return null;
  const name = m[1].trim();
  const rawParams = (m[2] ?? "").trim();
  const params = rawParams.length === 0
    ? []
    : rawParams.split(",").map((p) => p.trim());
  return { name, params };
}

export function renderTemplateBody(body: string, params: string[]): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_full, idx) => {
    const i = parseInt(idx, 10) - 1;
    return params[i] ?? "";
  });
}
