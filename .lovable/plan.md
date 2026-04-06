

# Correções: Classificação, Lembrete Prometido e Terminologia de Lentes

## Problemas Identificados

### 1. Coluna "Aguardando Resposta" — classificação errada
A coluna "Aguardando Resposta" pertence ao setor interno (Atendimento Gael). No entanto, a IA está classificando um contato de cliente nessa coluna. Isso ocorre porque o prompt lista TODAS as colunas disponíveis (incluindo as internas) no bloco `# CLASSIFICAÇÃO`, e o LLM pode escolher qualquer uma delas. A filtragem por setor acontece depois (linhas 1758-1767), mas se a coluna interna não tem correspondente no pipeline de vendas, o contato fica preso.

**Correção**: Filtrar as colunas enviadas no prompt para que o LLM só veja colunas do setor correto do contato. Clientes nunca devem ver colunas do setor Atendimento Gael no prompt.

### 2. Lembrete prometido pela IA para sexta-feira — não existe mecanismo
A IA prometeu "te aviso na sexta" mas não existe nenhuma tool para agendar lembretes avulsos (sem agendamento de visita). O sistema só dispara lembretes via `agendamentos-cron` quando há um agendamento registrado. Sem agendamento, nenhum lembrete será enviado. A IA fez uma promessa que não pode cumprir.

**Correção**: 
- Criar uma tool `agendar_lembrete` que registra um lembrete na tabela `tarefas` (ou nova tabela `lembretes`) com data de disparo
- O `vendas-recuperacao-cron` (ou novo cron) verifica lembretes pendentes e envia a mensagem
- Adicionar regra proibida: "NUNCA prometa ações futuras (lembretes, retornos, envios) sem usar a tool correspondente"

### 3. "Experimentar lentes" — terminologia incorreta
Na linha 1487 do ai-triage, após o orçamento, a IA pergunta "prefere agendar uma visita para experimentar?" — lentes de óculos são sob encomenda, não se experimentam. O que se experimenta são armações. Lentes de contato são outro departamento (encaminhar para atendimento humano).

**Correção**:
- Alterar a mensagem pós-orçamento (linha 1487) para não usar "experimentar"
- Adicionar regra proibida sobre "experimentar lentes"
- Adicionar instrução: lentes de contato → escalar para consultor

---

## Plano de Implementação

### Migration SQL
- Inserir regra proibida: "NUNCA diga 'experimentar lentes'. Lentes de óculos são sob encomenda. O que pode ser experimentado são armações."
- Inserir regra proibida: "Se o cliente perguntar sobre lentes de contato, encaminhe para um Consultor especializado."
- Inserir regra proibida: "NUNCA prometa ações futuras (lembretes, retornos, follow-ups) sem registrar via tool. Se não existe tool para isso, não prometa."
- Criar tabela `lembretes` (id, contato_id, atendimento_id, mensagem, data_disparo, status, created_at)

### `supabase/functions/ai-triage/index.ts`
1. **Filtrar colunas no prompt por setor** (bloco CLASSIFICAÇÃO ~linha 563): só enviar colunas do setor null para clientes, e colunas do setor Atendimento Gael para lojas/colaboradores
2. **Linha 1487**: Trocar "experimentar" por "conhecer as opções presencialmente" ou "provar armações"
3. **Nova tool `agendar_lembrete`**: permite à IA registrar um lembrete futuro com data e mensagem
4. **Instrução sobre lentes de contato**: no system prompt, adicionar que lentes de contato devem ser encaminhadas para consultor

### `supabase/functions/vendas-recuperacao-cron/index.ts` (ou novo cron)
- Adicionar bloco que verifica `lembretes` com `data_disparo <= now()` e `status = 'pendente'`
- Envia a mensagem via send-whatsapp e marca como `enviado`

---

## Arquivos Afetados

| Arquivo | Mudança |
|---------|---------|
| Migration SQL | Tabela `lembretes`, regras proibidas (experimentar lentes, lentes de contato, promessas sem tool) |
| `supabase/functions/ai-triage/index.ts` | Filtrar colunas por setor no prompt, tool `agendar_lembrete`, fix linha 1487, instrução lentes de contato |
| `supabase/functions/vendas-recuperacao-cron/index.ts` | Processar lembretes pendentes |

## Resultado

- Clientes nunca são classificados em colunas internas (Aguardando Resposta)
- IA só promete lembretes se registrar via tool — e o cron garante o envio
- Terminologia correta: lentes são encomenda, armações são experimentáveis
- Lentes de contato encaminhadas para consultor humano

