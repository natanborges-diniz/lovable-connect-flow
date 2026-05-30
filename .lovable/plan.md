## Objetivo

Disponibilizar o botão **🔍 Buscar lentes** (copiloto de cotação) também dentro do diálogo de detalhe do card aberto pelo Kanban do CRM, com o mesmo comportamento de `/atendimentos`.

## Onde adicionar

Componente `ContatoDetalhe` em `src/pages/Pipeline.tsx` (header do `Dialog` aberto via `setSelectedContatoId`, linhas ~939–984). O header é fixo acima do `ChatView`, então cobre operador conversando e visualizando histórico.

## Mudanças

1. **Imports** em `src/pages/Pipeline.tsx`:
   - `import { BuscarLentesSheet } from "@/components/atendimentos/BuscarLentesSheet";`
   - Acrescentar `Glasses` aos imports de `lucide-react`.

2. **Fetch de metadata do atendimento** — ampliar o `select` em `useQuery(["atendimento_contato", contatoId])` (linha 819) para incluir `metadata`:
   ```ts
   .select("id, modo, status, canal, canal_provedor, solicitacao_id, metadata")
   ```

3. **State** em `ContatoDetalhe`:
   ```ts
   const [buscarLentesOpen, setBuscarLentesOpen] = useState(false);
   ```

4. **Botão no header** — dentro do `DialogTitle` (linha 944), seguindo o mesmo padrão já aplicado em `Atendimentos.tsx`: variant `default`, ícone `Glasses`, texto oculto em `<sm`. Renderiza apenas quando `atendimentoId` está presente. Inclui `console.info("[BuscarLentes] aberto (CRM)", ...)` para telemetria leve.

5. **Sheet** — renderizar ao fim do `return` do `ContatoDetalhe` (ao lado do `TransferPipelineDialog`):
   ```tsx
   {atendimentoId && (
     <BuscarLentesSheet
       open={buscarLentesOpen}
       onOpenChange={setBuscarLentesOpen}
       atendimentoId={atendimentoId}
       atendimentoMetadata={atendimentoData?.metadata}
       contatoMetadata={(contato as any)?.metadata}
       onInsertComposer={() => {
         // ChatView do CRM não compartilha msgText state com ContatoDetalhe.
         // Por ora, o operador usa "Copiar" e cola no composer.
         toast.info("Mensagem copiada — cole no campo de envio");
       }}
     />
   )}
   ```

   > Observação: como `msgText` vive isolado dentro de `ChatView`, "Inserir no composer" no card do CRM apenas avisa o operador. O botão "Copiar" do `BuscarLentesSheet` continua funcionando normalmente. Plumbing de `setMsgText` cross-componente fica fora deste escopo (refactor maior).

## Fora de escopo

- Adicionar o botão dentro do `ChatView` do CRM (composer).
- Refatorar `ChatView` para expor `setMsgText` ao pai.
- Replicar em outras telas (`/lojas`, `/financeiro`, `/ti`, `/interno`) — pode vir num próximo passo se houver demanda.
