## Problema (caso Bianca, 28/04 12:07)

A IA pediu a receita por texto (OCR falhou 2x), a cliente respondeu:

```
Od -4.50
Oe -pl
```

E mesmo assim a IA escalou para humano em vez de rodar `consultar_lentes`. Diagnóstico:

1. **Detector só rodava em "correção"**: `detectPrescriptionCorrection` em `ai-triage/index.ts` está protegido por `if (receitas.length > 0)` (linha 2340). A Bianca não tinha receita salva (OCR sempre falhou), então o parser **nunca foi chamado**, mesmo com a IA tendo acabado de pedir os valores por texto.
2. **Parser exige ≥2 números**: a regra `numericPairs < 2` rejeita `Od -4.50 / Oe -pl` porque `pl` (plano = 0,00) não é parseado como número.
3. **Parser não conhece "pl/plano/zero/neutro"**: convenções ópticas comuns (`pl`, `plano`, `0`, `neutro`, `sc` = sem cilindro) ficam fora.
4. **Sem cilindro/eixo não é problema clínico**: `-4.50 esf only` é receita single_vision válida — deveria disparar orçamento direto.

## Solução

### 1. Parser entende convenções ópticas (`detectPrescriptionCorrection`)
- Pré-normalização adiciona: `pl`, `plano`, `neutro` → `0.00`; `sc` (sem cilindro) → ignora cilindro; aceita `oe` sozinho com valor único como esférico.
- Conta `pl/plano/neutro/zero` como número válido para o gate `numericPairs ≥ 2`.
- Aceita "esf-only" (sem cilindro/eixo) como receita válida em `single_vision`.

### 2. Detector roda mesmo SEM receita prévia
Quando a IA acabou de pedir os valores por texto (`MSG_PEDIR_RECEITA_TEXTO` está em uma das últimas 2 outbound) e o cliente responde com padrão de receita, criar nova entrada em `receitas[]` com `source: "client_typed_first"` em vez de exigir `receitas.length > 0`. Renomeia helper para `detectPrescription(text, mode)` onde `mode = "first" | "correction"`.

### 3. Após gravar, força `consultar_lentes` no mesmo turno
Mesma lógica do auto-chain pós-OCR: hint obrigatório + `tool_choice = consultar_lentes`. Se a tool não tiver opções para o grau (ex.: -4.50 esf), usa fallback "região" em vez de escalar.

### 4. Recuperação da Bianca (one-off)
Inserir manualmente em `contatos.metadata.receitas` a receita `OD -4.50 esf, OE 0.00 (plano)`, `rx_type=single_vision`, e re-disparar `ai-triage` no atendimento aberto para gerar o orçamento.

### 5. Memória
Atualiza `mem://ia/correcao-receita-por-texto` com a regra "também vale como primeira leitura" + convenções `pl/plano/neutro` + caso Bianca.

## Arquivos

- `supabase/functions/ai-triage/index.ts` — parser + gate (linhas 423-525, 2334-2380).
- Migration one-off para Bianca (`contatos.metadata` + chamada à edge `ai-triage`).
- `.lovable/memory/ia/correcao-receita-por-texto.md`
- `mem://index.md` — atualizar descrição da entrada.

## Não-mudanças

- Nada de novo modelo, prompt ou tool. Apenas o parser e o gatilho.
- Watchdogs e templates ficam como estão.
