

# Saída Segura da Fila Humana — Via Movimentação de Coluna

## Situação Atual

- O toggle `IA ↔ Humano` é um clique livre no badge do atendimento (linha 990-998 do Pipeline.tsx)
- O operador pode alternar sem nenhuma ação funcional no pipeline
- Não há vínculo entre "devolver para IA" e a posição do card no Kanban

## Nova Regra

O operador **só pode devolver o atendimento para a IA** ao **mover o card para outra coluna**. Ao fazer isso, o sistema automaticamente reseta `modo = 'ia'`, seguindo o fluxo normal de automações da coluna de destino.

O toggle manual direto (clique no badge) será **removido** — eliminando o risco de devolver para IA sem contexto ou sem ação.

## Mudanças

### 1. `src/pages/Pipeline.tsx` — `onDragEnd` (linhas 170-210)

Após o `updateContato.mutate` bem-sucedido, verificar se o contato está em `modo = 'humano'`. Se sim, resetar automaticamente para `modo = 'ia'`:

```typescript
// Dentro do onSuccess do updateContato.mutate:
const at = atendimentoByContato.get(contatoId);
if (at?.modo === "humano") {
  await supabase.from("atendimentos")
    .update({ modo: "ia" })
    .eq("id", at.id);
  toast.info("Modo IA reativado automaticamente");
}
```

### 2. `src/pages/Pipeline.tsx` — Remover toggle manual (linhas 982-998)

Substituir o badge clicável por um badge **somente leitura** que indica o modo atual, sem onClick. O operador vê o estado mas não pode alterná-lo diretamente.

### 3. Nenhuma mudança no banco

A coluna `modo` já existe. Não há migração necessária.

## Fluxo Final

```text
1. IA detecta necessidade → seta modo = 'humano'
2. Card aparece na Fila Humana (destaque pulsante)
3. Operador clica, lê contexto, conversa com cliente
4. Operador arrasta card para a coluna adequada (ex: Orçamento → Agendamento)
5. Sistema automaticamente: modo = 'ia' + dispara automações da coluna destino
6. Card sai da Fila Humana, IA retoma
```

## Resultado

- Sem toggle manual = sem risco de devolver para IA "no vácuo"
- Toda devolução é vinculada a uma ação funcional (mover coluna)
- Automações da coluna destino são executadas normalmente
- Operador mantém visibilidade do modo via badge read-only

