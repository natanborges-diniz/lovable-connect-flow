## Problema

Gabriely descreveu que **perdeu a receita** e precisa **refazer o exame**. Não enviou imagem. Mesmo assim a IA respondeu:

> "Recebi sua receita 👀 Já estou analisando…"

## Causa-raiz

`supabase/functions/ai-triage/index.ts` linha **867** (`deterministicIntentFallback`):

```ts
if (/receita|grau|prescri[cç][aã]o|oftalmol[oó]g|enviei minha receita|recebeu minha receita/.test(n)) {
  return {
    resposta: "Recebi sua receita 👀 Já estou analisando…",
    ...
  };
}
```

A regex casa qualquer texto contendo "receita" / "oftalmolog" — inclusive frases como "perdi a receita", "preciso refazer a receita". O ramo só faria sentido após confirmação de envio (`enviei minha receita`, `recebeu minha receita`), mas a alternância `|` aplica todos os termos isoladamente.

Ou seja: o ramo de imagem (linha 828, `isImageContext`) está correto; o problema é esse fallback textual genérico que finge ter recebido algo que não chegou.

## Mudanças

### 1. `ai-triage/index.ts` linha 867 — refinar o gate

- Remover do regex as palavras isoladas (`receita`, `grau`, `prescri…`, `oftalmolog…`).
- Manter **somente** as frases que afirmam envio: `enviei minha receita`, `te mandei a receita`, `recebeu minha receita`, `mandei a foto`, `segue a receita`.
- Para o caso geral em que o cliente fala sobre receita sem ter enviado nada, deixar cair nos ramos seguintes (`/lente|oculos|orçamento.../` linha 876) que pedem a foto: "Me manda uma foto da sua receita…".

### 2. Novo ramo "perdeu / sem receita / precisa refazer exame"

Antes do fallback de orçamento (linha 876), adicionar gate específico:

```ts
if (/perdi a receita|sem receita|n[aã]o tenho (a )?receita|refazer (o )?exame|fazer (o )?exame|preciso de (uma )?receita|preciso fazer (o )?exame/.test(n)) {
  return {
    resposta: "Sem problema! Posso te indicar uma clínica parceira aqui perto pra refazer o exame — costuma virar desconto na sua compra. Me passa o bairro ou região que você está pra eu te orientar 😊",
    intencao: "indicacao_clinica",
    pipeline_coluna: "Orçamento",
    precisa_humano: false,
  };
}
```

Isso resolve o caso Gabriely: ela diz "perdi a receita … refazer o exame" → cai no ramo de indicação de clínica em vez de "Recebi sua receita".

### 3. Validação

Curl `ai-triage` com payload simulando texto da Gabriely (sem imagem). Esperado: resposta de indicação de clínica, **não** "Recebi sua receita".

Auditoria pós-deploy:

```sql
SELECT m.conteudo, e.created_at
FROM eventos_crm e JOIN mensagens m ON m.id = e.mensagem_id
WHERE m.conteudo ILIKE 'Recebi sua receita%'
  AND e.created_at > now() - interval '7 days';
```

Para cada hit, conferir se a inbound imediatamente anterior tem anexo de imagem; nenhum caso textual puro deve aparecer.

### 4. Memory

Atualizar `mem://ia/auto-receita-e-anti-loop` com nota:

> "Recebi sua receita" só dispara com imagem real (`isImageContext`) ou quando o cliente afirma envio explícito ("enviei", "te mandei", "segue", "recebeu"). Menção textual a "receita" / "perdi a receita" / "refazer exame" não confirma recebimento — roteia para indicação de clínica ou pedido de foto.

## Fora de escopo

- Outros caminhos do fluxo de receita (interpretar_receita, watchdogs).
- Escalada após 2 rejeições (já entregue em plano anterior).
- Frontend.

## Arquivos

- `supabase/functions/ai-triage/index.ts` (linhas ~867 e ~876).
- `.lovable/memory/ia/auto-receita-e-anti-loop.md`.
