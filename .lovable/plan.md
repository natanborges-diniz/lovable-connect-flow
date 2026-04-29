## Contexto

Plano para o projeto **InFoco Messenger** (não Atrium). O wizard que renderiza fluxos (`bot_fluxos.etapas[]`) está em `src/pages/LojaNovaDemanda.tsx` e consome o Supabase compartilhado. Todas as mudanças abaixo são genéricas — valem para **qualquer fluxo** atual e futuro, não só reembolso.

### Já está pronto (não mexer)
- Botões "Tirar foto" (`capture="environment"`) e "Anexar imagem".
- Upload em bucket público.
- Wizard dinâmico das `etapas[]`.

### O que falta (genérico)
1. Renderizador da etapa `tipo_input: "texto_prefilled"` que pré-preenche o nome do **solicitante** quando o usuário logado é `loja` ou `colaborador` (setor_operador). Pessoa final não vê esse campo (ou vê em branco e edita).
2. Renderizador da etapa `tipo_input: "loja"` que:
   - Auto-preenche se o usuário logado é `loja`/`colaborador` (`useLojaContext().lojaNome`), e oculta/trava o campo.
   - Mostra **combobox com lista de lojas ativas** se o usuário for `setor_operador` ou pessoa final.
3. Toda etapa `tipo_input: "imagem"` aceita **múltiplos arquivos** + **PDF** (não apenas para reembolso).

### Já feito no Atrium (não desfazer)
- Migração que adicionou `nome_solicitante` (`tipo_input: "texto_prefilled"`) em `bot_fluxos.reembolso`. **Vai ficar útil** porque o renderizador genérico desse plano funciona para todos os fluxos.
- Lógica antiga no `bot-lojas/index.ts` é código morto (WA corporativo descontinuado). Limpeza separada depois.

## Mudanças no InFoco Messenger

Arquivo principal: `src/pages/LojaNovaDemanda.tsx`. Eventualmente um pequeno hook novo (`useLojasAtivas`) para listar lojas.

### 1. Renderizador genérico para `texto_prefilled` (nome do solicitante)

```ts
type EtapaInput =
  | "texto" | "decimal" | "inteiro" | "cpf" | "documento" | "imagem"
  | "texto_prefilled" | "loja";
```

No topo do componente, resolver o nome a sugerir uma vez:

```ts
const [profileNome, setProfileNome] = useState<string>("");
useEffect(() => {
  if (!user) return;
  (async () => {
    const { data } = await supabase
      .from("profiles")
      .select("nome, tipo_usuario")
      .eq("id", user.id)
      .maybeSingle();
    if (data?.nome) setProfileNome(data.nome);
  })();
}, [user]);
```

Ao entrar em um fluxo, pré-preencher **toda etapa** `texto_prefilled` com `profileNome` (o autor logado é sempre o "responsável que está lançando a demanda"):

```ts
const initial: Record<string,string> = {};
for (const et of fluxo.etapas) {
  if (et.tipo_input === "texto_prefilled" && profileNome) {
    initial[et.campo] = profileNome;
  }
}
setDados(initial);
```

Renderização: `<Input>` editável normal (mesmas regras de validação do `texto`). Não esconder — o usuário pode trocar, ex.: "Maria atendendo pelo João".

Observação: se o usuário for **pessoa final** (não tem profile interno), `profileNome` virá vazio e o campo aparece em branco para preencher manualmente. Comportamento correto sem if/else explícito.

### 2. Renderizador genérico para `loja` (a qual loja a demanda se refere)

Hoje o componente já tem `useLojaContext()` com `lojaNome` quando o usuário é loja/colaborador. Vamos formalizar isso como uma etapa `tipo_input: "loja"` que pode aparecer em qualquer fluxo:

a) Hook novo `src/hooks/useLojasAtivas.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useLojasAtivas() {
  return useQuery({
    queryKey: ["lojas-ativas"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("telefones_lojas")
        .select("nome_loja")
        .eq("tipo", "loja")
        .eq("ativo", true)
        .order("nome_loja");
      if (error) throw error;
      const seen = new Set<string>();
      return (data ?? [])
        .map((r) => r.nome_loja?.trim())
        .filter((n): n is string => !!n && !seen.has(n.toLowerCase()) && !!seen.add(n.toLowerCase()));
    },
  });
}
```

b) Pré-preencher no boot do fluxo quando o usuário tem loja vinculada:

```ts
for (const et of fluxo.etapas) {
  if (et.tipo_input === "loja" && lojaNome) initial[et.campo] = lojaNome;
}
```

c) Renderização:

- Se `lojaNome` (do `useLojaContext`) **e** `tipo_usuario IN ('loja','colaborador')`: mostrar como `<Input>` em modo readonly + badge "minha loja" (sem combobox; o valor já está em `dados[et.campo]`).
- Senão (setor_operador ou pessoa final): combobox com `useLojasAtivas()` — `<select>` simples ou um `Combobox` se já existir no design system. Validação: obrigatório (a menos que a etapa marque `obrigatorio:false`).

Submit não muda: `dados[et.campo]` carrega o `nome_loja` em ambos os casos.

### 3. Etapas `imagem` aceitam múltiplos arquivos e PDF (genérico)

Mudar o estado:

```ts
const [anexos, setAnexos] = useState<Record<string, Anexo[]>>({});
```

No bloco do `tipo_input === "imagem"`:

- Input "Tirar foto": continua `accept="image/*"` + `capture="environment"`, single (uma foto por clique; o usuário pode clicar várias vezes).
- Input "Anexar arquivo" (renomear de "Anexar imagem"): `accept="image/*,application/pdf"` + atributo `multiple`.
- `uploadImagem` (renomear para `uploadAnexo`) faz `push` no array da etapa em vez de substituir; aceita iterar sobre `FileList` quando `multiple`.
- Preview vira `.map()`: thumbnail para `mime_type` que comece com `image/`, ícone de PDF (`FileText` do lucide) quando `application/pdf`. Cada item tem botão "X" pra remover.
- Validação obrigatória: `if (et.obrigatorio !== false && !(anexos[et.campo]?.length))`.
- Limites por arquivo: `file.size <= 10 * 1024 * 1024` (toast de erro se passar). Cap por etapa: 10 arquivos.
- Submit continua: `anexos: Object.values(anexos).flat()` — formato que `criar-solicitacao-loja` já espera.

### 4. Tipos de validação

```ts
function validar(et: Etapa, raw: string) {
  if (et.tipo_input === "texto_prefilled") {
    // mesmas regras de texto
  }
  if (et.tipo_input === "loja") {
    if (et.obrigatorio !== false && !raw.trim()) return "Selecione uma loja";
  }
  // resto inalterado
}
```

## Como o usuário vai ver (qualquer fluxo, não só reembolso)

| Usuário logado | Etapa `texto_prefilled` (responsável) | Etapa `loja` |
|---|---|---|
| Loja / colaborador | nome do logado, editável | loja vinculada, readonly + badge |
| Setor_operador | nome do logado, editável | combobox com todas as lojas ativas |
| Pessoa final | em branco, edita manualmente | combobox com todas as lojas ativas |

Em qualquer etapa `imagem` (reembolso, garantia futura, sinistro, etc.):
- "Tirar foto" → câmera nativa.
- "Anexar arquivo" → galeria + arquivos (PDF), permite múltiplos.
- Lista de previews com remover.

## Como executar

Eu (IA do Atrium) não consigo editar o projeto InFoco daqui. Opções:

1. **Recomendado**: abre o [InFoco Messenger](/projects/2d68a67b-8187-4e4e-9d36-8dcf8e39cebb), cola este plano no chat de lá e aprova.
2. Aplica manualmente no editor do InFoco seguindo as 4 seções (mexem em `src/pages/LojaNovaDemanda.tsx` e criam `src/hooks/useLojasAtivas.ts`).

Backend já está pronto — nada muda no Atrium. Para ativar a etapa `loja` em um fluxo específico (ex.: `reembolso`), o operador adiciona uma etapa com `tipo_input:"loja"` no JSON em `bot_fluxos` (via UI de Configurações ou migração) e ela passa a renderizar automaticamente.
