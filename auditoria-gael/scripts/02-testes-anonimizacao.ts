/**
 * Testes da função anonimizar() e anonimizarTextoComNome().
 * Sem framework — usa assert nativo do Node.
 * Rodar: npm run test  (ou: tsx scripts/02-testes-anonimizacao.ts)
 */
import assert from "node:assert/strict";
import { anonimizar, anonimizarTextoComNome } from "./lib/anonimizacao.js";

let passed = 0;
let failed = 0;

function test(desc: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${desc}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${desc}`);
    console.error(`    ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }
}

console.log("=== Testes de anonimização ===\n");

// ─── anonimizar() ─────────────────────────────────────────────────────────────

// 1. Telefone +55 sem parênteses
test("1. Tel +55 sem parênteses", () => {
  assert.equal(anonimizar("+5511999998888"), "+55XXXXXXXXX");
});

// 2. Telefone com parênteses
test("2. Tel com parênteses", () => {
  assert.equal(anonimizar("(11) 99999-8888"), "(XX) XXXX-XXXX");
});

// 3. CPF formatado
test("3. CPF formatado", () => {
  assert.equal(anonimizar("123.456.789-00"), "CPF_REDIGIDO");
});

// 4. CPF sem pontuação (11 dígitos)
test("4. CPF sem pontuação", () => {
  assert.equal(anonimizar("12345678900"), "CPF_REDIGIDO");
});

// 5. CNPJ
test("5. CNPJ", () => {
  assert.equal(anonimizar("12.345.678/0001-90"), "CNPJ_REDIGIDO");
});

// 6. Email
test("6. Email", () => {
  assert.equal(anonimizar("joao@empresa.com.br"), "email@redigido");
});

// 7. CEP com hífen
test("7. CEP com hífen", () => {
  assert.equal(anonimizar("06180-280"), "CEP_REDIGIDO");
});

// 8. CEP sem hífen
test("8. CEP sem hífen", () => {
  assert.equal(anonimizar("06180280"), "CEP_REDIGIDO");
});

// 9. Data DD/MM/AAAA
test("9. Data DD/MM/AAAA", () => {
  assert.equal(anonimizar("15/03/1985"), "DATA_REDIGIDA");
});

// 10. Nome simples (Primeiro Último)
test("10. Nome simples", () => {
  assert.equal(anonimizar("Natan Borges"), "PESSOA_REDIGIDA");
});

// 11. Nome com partícula
test("11. Nome com partícula", () => {
  assert.equal(anonimizar("Maria de Fátima Silva"), "PESSOA_REDIGIDA");
});

// 12. Nome com acento
test("12. Nome com acento", () => {
  assert.equal(anonimizar("João Conceição"), "PESSOA_REDIGIDA");
});

// 13. Texto misto: múltiplas PIIs numa mesma string.
// NOTA: a regex de nomes (step 7) substitui qualquer token Uppercase+lowercase(s),
// incluindo palavras como "Oi". Verificamos por ausência de PII real, não por
// igualdade de string completa (que variaria conforme tokens capitalizados presentes).
test("13. Texto misto (tel + CPF + nome)", () => {
  const input = "Oi, sou Natan Borges, CPF 123.456.789-00, fone (11) 99999-8888";
  const result = anonimizar(input);
  assert.ok(result.includes("PESSOA_REDIGIDA"),  `esperado PESSOA_REDIGIDA, obtido: ${result}`);
  assert.ok(result.includes("CPF_REDIGIDO"),     `esperado CPF_REDIGIDO, obtido: ${result}`);
  assert.ok(result.includes("(XX) XXXX-XXXX"),   `esperado (XX) XXXX-XXXX, obtido: ${result}`);
  assert.ok(!result.includes("Natan"),           "nome 'Natan' não deve aparecer no output");
  assert.ok(!result.includes("123.456.789-00"),  "CPF real não deve aparecer no output");
  assert.ok(!result.includes("99999-8888"),      "telefone real não deve aparecer no output");
});

// ─── anonimizarTextoComNome() ─────────────────────────────────────────────────

// 14. Substituição via nome do contato — case-insensitive pelo pré-regex.
// O texto usa "natan" em minúsculo (não capturado pela regex genérica de nomes),
// mas substituído pelo pré-regex determinístico antes de anonimizar() rodar.
test("14. anonimizarTextoComNome — substitui nome case-insensitive", () => {
  const alias = "Cliente_abc123";
  const result = anonimizarTextoComNome(
    "natan aqui, tudo bem?",
    "Natan Borges",
    alias
  );
  // "natan" deve ser substituído pelo alias (pré-regex, case-insensitive)
  assert.ok(
    result.startsWith(alias),
    `deve começar com '${alias}', obtido: '${result}'`
  );
  assert.ok(
    !result.toLowerCase().includes("natan"),
    `'natan' não deve aparecer no output, obtido: '${result}'`
  );
});

// ─── Resumo ───────────────────────────────────────────────────────────────────
console.log(`\n─── Resultado ──────────────────────────`);
console.log(`  Passou : ${passed}`);
console.log(`  Falhou : ${failed}`);
console.log(`────────────────────────────────────────`);

if (failed > 0) {
  console.error(`\n⚠️  ${failed} teste(s) falharam.`);
  process.exit(1);
}
console.log("\n✅ Todos os testes passaram.");
