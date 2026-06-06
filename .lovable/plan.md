## Problema

Quando o cliente pergunta sobre status do pedido fora do horário de atendimento humano, a IA escala para consultor sem informar que a resposta só virá no próximo expediente. Isso ocorre em dois caminhos:

1. **Router pre-LLM de texto** (`ai-triage` linha ~2799) — usa `renderMsgFixa("os_escalada", …)` direto, sem checar `isHorarioHumano()`.
2. **Botão "🔍 Status do pedido"** (linha ~9001-9005) — mensagem hardcoded "Vou te conectar com um consultor… Só um instante 🙂", também sem checar horário. (Foi exatamente esse o caso do print do Paulo.)

Todas as outras escaladas no `ai-triage` já fazem o padrão `isHorarioHumano() ? "<expediente>" : mensagemEscaladaForaHorario(nome)`, mas o intent `consulta_os` ficou de fora.

## Mudanças

Arquivo único: `supabase/functions/ai-triage/index.ts`.

### 1. Router de texto (~linha 2799)
Trocar a montagem da `osMsg` por uma versão horário-aware:

```ts
const osMsgExpediente = renderMsgFixa("os_escalada", { nome_comma: _prim ? `, ${_prim}` : "" });
const osMsg = isHorarioHumano()
  ? osMsgExpediente
  : `${osMsgExpediente}\n\n⏰ Estamos fora do horário de atendimento humano agora. Assim que reabrirmos (${proximaAberturaHumana()}), um consultor confirma o status do seu pedido.`;
```

Mantém a mensagem fixa editável (`os_escalada` continua pedindo nº da OS ou nome completo) e apenas adiciona o aviso de expediente quando aplicável. Sem nova chave em `ia_mensagens_fixas` para não exigir migration.

### 2. Botão "Status do pedido" (~linha 9001-9005)
Substituir o texto hardcoded pela mesma lógica:

```ts
case "status_pedido": {
  const { data: ctOs } = await supabase.from("contatos").select("nome").eq("id", atendimento.contato_id).maybeSingle();
  const _prim = (ctOs?.nome || "").trim().split(/\s+/)[0] || "";
  const msg = isHorarioHumano()
    ? "Vou te conectar com um consultor pra verificar o status do seu pedido. Só um instante 🙂"
    : mensagemEscaladaForaHorario(_prim);
  await sendWhatsApp(supabaseUrl, serviceKey, atId, msg);
  await supabase.from("atendimentos").update({ modo: "humano" }).eq("id", atId);
  await supabase.from("eventos_crm").insert({
    contato_id: atendimento.contato_id, tipo: "consulta_os",
    descricao: "Botão Status do pedido — escalado",
    metadata: { fora_horario: !isHorarioHumano() },
    referencia_tipo: "atendimento", referencia_id: atId,
  });
  return true;
}
```

### Memória
Atualizar `mem://ia/consulta-os-escalada-humano` registrando que a escalada (router e botão) respeita o expediente e avisa o próximo horário.

## Fora de escopo
- Não cria nova chave em `ia_mensagens_fixas` (o texto fora-horário é concatenado in-loco; o trecho do expediente continua editável via `os_escalada`).
- Não altera o restante do fluxo (move card, marca `intent_consulta_os_at`, dispara `handleNonClientEscalation`).
- Não muda watchdogs nem outras escaladas (já corretas).
