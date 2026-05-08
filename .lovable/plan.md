## Diagnóstico

Verifiquei o código do projeto **InFoco Messenger** e o `src/pages/GrupoChat.tsx` **já contém** a implementação do popover "Visualizações" (linhas 714–762). Provavelmente o que falta no seu lado é:

1. O deploy/preview não está atualizado, OU
2. A coluna `lida` em `mensagens_internas` não está sendo atualizada (o popover existe mas mostra todos como "○ pendente"), OU
3. O botão dos ticks `✓✓ N/M` não está visível por estilo CSS muito sutil.

## O que pedir lá no InFoco Messenger

Abra o projeto **InFoco Messenger** e cole **exatamente** o prompt abaixo no chat de lá (o agente daquele projeto tem acesso de escrita ao código):

---

> Em `src/pages/GrupoChat.tsx`, confirme que o bloco `mine && !apagada` (~linhas 714–763) renderiza o `<Popover>` com `PopoverTrigger` (botão `✓✓ N/M`) e `PopoverContent` listando `m.destinatarios_ids` com ✓✓ se `m.leitores_ids.includes(pid)` ou ○ caso contrário. Se sim:
>
> 1. Aumente a visibilidade do trigger: troque `text-[10px]` por `text-[11px] font-medium underline decoration-dotted underline-offset-2` no `<span>{m.lidas_count}/{m.total_copias}</span>` para o usuário perceber que é clicável.
> 2. Garanta que o realtime UPDATE em `mensagens_internas` está atualizando o estado local — confirme o handler `event: "UPDATE"` (~linha 242) faz `setMessages(prev => prev.map(x => x.id === m.id ? {...x, ...m} : x))`. Sem isso, `lida` nunca vira `true` no cliente do remetente.
> 3. Verifique a RLS de `mensagens_internas`: o remetente precisa ter SELECT em todas as N cópias do broadcast (não só nas dele) para o `lidas_count` refletir leitura dos outros. Se a policy estiver restrita a `auth.uid() in (remetente_id, destinatario_id)`, o remetente vê todas as cópias dele (porque é remetente em todas) — mas confirme rodando: `select destinatario_id, lida from mensagens_internas where conversa_id = 'grupo_<id>' and remetente_id = auth.uid()`.
> 4. Para chat 1:1 (`src/pages/ConversaDetail.tsx`), adicione um `<MessageTicks status={m.lida ? "read" : "sent"} />` no rodapé das mensagens próprias se ainda não houver.
>
> Após aplicar, abra um grupo, envie uma mensagem, peça para outro membro abrir o grupo e confirme que o contador `0/N` vira `1/N` em tempo real e o popover lista quem leu.

---

## Se mesmo assim não funcionar

Me avise qual destes ocorre:
- (a) O botão `✓✓ N/M` não aparece de jeito nenhum → problema de deploy.
- (b) Aparece `✓ 0/N` e nunca atualiza → realtime/RLS.
- (c) Clico e o popover abre mas todos aparecem como ○ → coluna `lida` não está sendo escrita pelo cliente do destinatário.

Com essa info eu te dou o ajuste cirúrgico para colar lá.