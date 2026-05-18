import { createHash } from "crypto";

export function md5hex(s: string): string {
  return createHash("md5").update(s).digest("hex");
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Aplica 7 camadas de remoção de PII a um texto livre.
 * Ordem importa: identificadores estruturados (tel, CPF, CNPJ) antes de nomes.
 */
export function anonimizar(texto: string): string {
  let t = texto;

  // 1. Telefones BR em múltiplos formatos
  t = t.replace(/\+?55\s*\(?\d{2}\)?\s*9?\s*\d{4}[-\s]?\d{4}/g, "+55XXXXXXXXX");
  t = t.replace(/\(\d{2}\)\s*9?\d{4}[-\s]?\d{4}/g, "(XX) XXXX-XXXX");

  // 2. CPF
  t = t.replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "CPF_REDIGIDO");

  // 3. CNPJ
  t = t.replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, "CNPJ_REDIGIDO");

  // 4. Email
  t = t.replace(/[\w._%+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "email@redigido");

  // 5. CEP
  t = t.replace(/\b\d{5}-?\d{3}\b/g, "CEP_REDIGIDO");

  // 6. Datas DD/MM/AAAA e variantes (DD-MM-AA, etc.)
  t = t.replace(/\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/g, "DATA_REDIGIDA");

  // 7. Nomes próprios com partículas (de, da, do, das, dos, e)
  t = t.replace(
    /\b[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ][a-záéíóúâêîôûãõç]+(?:\s+(?:de|da|do|das|dos|e)\s+[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ]?[a-záéíóúâêîôûãõç]+)*(?:\s+[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ][a-záéíóúâêîôûãõç]+)*\b/g,
    "PESSOA_REDIGIDA"
  );

  return t;
}

/**
 * Passo pré-regex determinístico: substitui o nome real do contato (e primeiro
 * nome, se >= 4 chars) pelo alias antes de aplicar anonimizar(). Garante cobertura
 * mesmo para variações de capitalização não capturadas pela regex genérica.
 */
export function anonimizarTextoComNome(
  texto: string,
  nomeContato: string | null,
  alias: string
): string {
  let t = texto;

  if (nomeContato && nomeContato.trim().length > 0) {
    const nomeCompleto = nomeContato.trim();
    // nome completo (case-insensitive)
    t = t.replace(new RegExp(escapeRegex(nomeCompleto), "gi"), alias);
    // primeiro nome isolado (só se >= 4 chars, evita substituir "de", "da", etc.)
    const primeiroNome = nomeCompleto.split(/\s+/)[0];
    if (primeiroNome.length >= 4) {
      t = t.replace(new RegExp(`\\b${escapeRegex(primeiroNome)}\\b`, "gi"), alias);
    }
  }

  return anonimizar(t);
}
