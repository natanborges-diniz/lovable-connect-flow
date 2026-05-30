## Problema

O botão **🔍 Buscar lentes** já existe em `src/pages/Atendimentos.tsx:364`, dentro da faixa de badges do header (status, canal, Oficial, modo IA/Humano, Acionar loja). Em telas estreitas (~875px) ele se mistura visualmente aos badges e não tem destaque — por isso "não aparece".

## Solução

Reposicionar e dar destaque visual, sem mudar comportamento.

### 1. Tirar o botão da linha de badges

Em `src/pages/Atendimentos.tsx`, remover o `<Button>` "Buscar lentes" do bloco de badges (linhas 364–366).

### 2. Adicionar ao lado do título, sempre visível

Colocar como **ação fixa no `DialogHeader`** (linha 343), alinhada à direita do título, na mesma linha do `MessageSquare` e do nome do atendimento:

```text
[💬 Assunto do atendimento ............]  [🔍 Buscar lentes]
[badge status][canal][modo][acionar loja]
```

- Variant `default` (cor primária) em vez de `outline`, para se diferenciar dos badges
- Tamanho `sm`, ícone `Glasses`, texto "Buscar lentes" sempre visível em ≥sm; em mobile (`<sm`) só ícone com `aria-label`
- Tooltip "Copiloto de cotação de lentes (Gael)" para reforçar a função

### 3. Atalho no composer (segundo ponto de entrada)

Adicionar um botão-ícone discreto `Glasses` na barra de ações do composer (perto de Paperclip/anexos), para o operador que já está digitando a resposta. Mesmo `onClick={() => setBuscarLentesOpen(true)}`.

### 4. Telemetria leve

`console.info("[BuscarLentes] aberto", { atendimentoId: id })` no click, para confirmar via logs se for reportado de novo.

## Fora de escopo

- Mudar a lógica do `BuscarLentesSheet`, do edge function `buscar-lentes-operador`, ou do fluxo da IA
- Adicionar o botão em outras telas (CRM/Lojas/etc.) — confirmado que o chat só vive em `/atendimentos`
