## Objetivo
No copiloto "Buscar lentes", além da mensagem combinada que já existe, oferecer **três variantes prontas para envio** — Econômica, Intermediária e Premium — espelhando o formato que a IA usa, para que o operador escolha qual faixa enviar ao cliente.

## Mudanças

### 1. Edge function `buscar-lentes-operador`
Em `buscarOculos` (e por reflexo `estimativa`) e `buscarLC`, além de `mensagem_formatada_cliente` (já existente, com as 3 faixas juntas), retornar também:

```ts
mensagens_por_faixa: {
  economica?: string,
  intermediaria?: string,
  premium?: string,
}
```

Cada string segue o mesmo cabeçalho/rodapé da combinada, mas contém só o bloco da faixa correspondente:

- Cabeçalho do grau (igual ao já existente): `🔍 Opções de lentes para o seu grau:` + linha OD/OE.
- Bloco único: `🟢 Econômica:` **ou** `🟡 Intermediária:` **ou** `💎 Premium:` com seus itens.
- Rodapé: `MSG_CTA_AGENDAMENTO`.

Para LC, mesma ideia: cabeçalho `👁️ Lentes de contato — opções:` + a única opção da faixa + a pergunta final sobre descarte.

Faixas vazias não aparecem em `mensagens_por_faixa`.

### 2. `BuscarLentesSheet.tsx`
Na seção de resultado, abaixo do textarea da mensagem combinada (que continua existindo como "Mensagem completa — 3 faixas"), adicionar um bloco **"Enviar por faixa"** com até 3 cards (um por faixa retornada):

```
[🟢 Econômica]   [Copiar] [Inserir no campo de envio]
[🟡 Intermediária]   [Copiar] [Inserir no campo de envio]
[💎 Premium]   [Copiar] [Inserir no campo de envio]
```

Cada card mostra um `Textarea` somente-leitura compacto (4–6 linhas) com a mensagem da faixa, e dois botões que reutilizam `copiarMsg`/`inserirNoComposer` parametrizados por texto.

Refatorar `copiarMsg`/`inserirNoComposer` para aceitar `(texto: string)` em vez de ler `result.mensagem_formatada_cliente` fixo. Os botões existentes da mensagem combinada passam a chamar com `result.mensagem_formatada_cliente`.

### Fora do escopo
- Mudar a lógica de particionamento das faixas (continua igual ao mirror do `runConsultarLentes`).
- Alterar o modo Catálogo (não tem faixas).
- Tocar no chat/composer ou na lógica de envio em si — segue tudo via `onInsertComposer` já existente.

## Arquivos
- `supabase/functions/buscar-lentes-operador/index.ts`
- `src/components/atendimentos/BuscarLentesSheet.tsx`
