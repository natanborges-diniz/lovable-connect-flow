

## Plano: Corrigir Agendamentos Duplicados e Mensagens Redundantes

### Problemas Identificados

1. **Mensagem duplicada por agendamento**: Quando a IA chama `agendar_visita`, a function `agendar-cliente` envia uma mensagem de confirmação formatada (✅ Agendamento confirmado!) via `send-whatsapp`. Depois, a IA TAMBÉM envia `args.resposta` como segunda mensagem. Resultado: cliente recebe duas mensagens por agendamento.

2. **Agendamento duplicado**: Não há verificação de agendamento existente. Quando o cliente confirma algo que já foi agendado, a IA chama `agendar_visita` novamente, criando um segundo registro.

3. **Pergunta contraditória sobre lembrete**: A confirmação diz "Vou te enviar um lembrete no dia anterior 😉" e depois a IA pergunta "Quer que eu envie um lembrete?" — redundante e confuso.

### Solução

**1. Eliminar mensagem duplicada (`ai-triage/index.ts`)**

No bloco que processa `agendar_visita` / `reagendar_visita` (linha ~823), ao invés de usar `args.resposta` como resposta da IA, definir `resposta = ""` (vazio). A `agendar-cliente` já envia a mensagem bonita formatada. A IA não precisa enviar nada adicional.

Ou melhor: remover o envio de WhatsApp da `agendar-cliente` e deixar só a IA responder (mais controle). A opção mais limpa é **remover o `send-whatsapp` da `agendar-cliente`**, já que a confirmação formatada pode ser montada direto no `args.resposta` da IA.

**Decisão**: Remover o envio de mensagem da `agendar-cliente/index.ts` (linhas 57-72). A IA já envia a resposta. O `agendar-cliente` fica responsável apenas por criar o registro e logar o evento CRM.

**2. Verificar duplicata antes de criar (`ai-triage/index.ts`)**

No bloco `agendar_visita` (linha ~839), antes de chamar `agendar-cliente`, verificar se já existe um agendamento ativo para o mesmo contato + loja + mesma data. Se existir, pular a criação e apenas responder ao cliente que o agendamento já está confirmado.

```
// Pseudocódigo
const jaExiste = agendamentosAtivos.some(a => 
  a.loja_nome === args.loja_nome && 
  a.data_horario.startsWith(args.data_horario.substring(0, 10)) &&
  (a.status === "agendado" || a.status === "confirmado")
);
if (jaExiste) {
  // Não criar novo — apenas confirmar ao cliente
  resposta = args.resposta; // usa resposta da IA sem criar duplicata
  // Pular chamada a agendar-cliente
}
```

**3. Instrução no prompt para não perguntar sobre lembrete (`ai-triage/index.ts`)**

Adicionar na seção de regras do prompt:
```
REGRA: Quando agendar uma visita, NÃO pergunte se o cliente quer lembrete — 
o lembrete é automático. Apenas confirme os dados e encerre.
Após confirmação do cliente, NÃO crie outro agendamento — 
apenas confirme que está tudo certo.
```

### Arquivos Alterados

1. **`supabase/functions/agendar-cliente/index.ts`**
   - Remover bloco de envio WhatsApp (linhas 57-72) — a IA já responde

2. **`supabase/functions/ai-triage/index.ts`**
   - Adicionar verificação de duplicata antes de chamar `agendar-cliente`
   - Adicionar regra no prompt: "NÃO pergunte sobre lembrete" e "Após confirmação, NÃO crie novo agendamento"
   - No `proximo_passo` da tool `agendar_visita`, instruir que após agendamento o próximo passo é aguardar (não perguntar sobre lembrete)

### Resultado

- Cliente recebe UMA única mensagem de confirmação (da IA)
- Confirmações subsequentes ("confirmado") não criam agendamento duplicado
- Sem pergunta contraditória sobre lembrete

