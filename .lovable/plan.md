
Usuário quer que eu envie a mensagem corretiva (sobre oftalmologista/clínicas parceiras) para o cliente Mi no número 5511970831864 — mensagem que defini na resposta anterior.

## Mensagem a enviar
> "Oi Mi, desculpa a confusão antes! 🙏 Sobre sua pergunta: a gente **não tem oftalmologista dentro da loja** (por lei óticas não fazem exame), mas trabalhamos com **clínicas oftalmológicas parceiras** próximas que indicamos sem compromisso. O ideal é você passar em uma das nossas unidades — nossa equipe te direciona pra clínica parceira mais próxima e já aproveita pra te mostrar opções de armação e lente. Qual região fica melhor pra você?"

## Como enviar
Em modo default vou:
1. Localizar o `atendimento_id` ativo do contato com telefone `5511970831864` via SQL (`contatos` → `atendimentos` mais recente em `aguardando`/`em_atendimento`).
2. Chamar a edge function `send-whatsapp` com:
   - `atendimento_id`: o encontrado
   - `texto`: a mensagem acima (sem markdown `**`, WhatsApp usa `*` simples — vou converter)
   - `remetente_nome`: `"Gael"` (mantém persona da IA, já que é correção de fluxo da IA, não escalada humana)
3. Confirmar entrega via resposta da função.

Texto formatado para WhatsApp (negritos com `*`):
> "Oi Mi, desculpa a confusão antes! 🙏 Sobre sua pergunta: a gente *não tem oftalmologista dentro da loja* (por lei óticas não fazem exame), mas trabalhamos com *clínicas oftalmológicas parceiras* próximas que indicamos sem compromisso. O ideal é você passar em uma das nossas unidades — nossa equipe te direciona pra clínica parceira mais próxima e já aproveita pra te mostrar opções de armação e lente. Qual região fica melhor pra você?"

## Sem mudanças no código
Operação pontual de envio — nenhum arquivo alterado, nenhuma migração. Só uma chamada à EF existente.

## Resultado esperado
- Mi recebe a mensagem corretiva no WhatsApp pelo mesmo canal (Evolution).
- Mensagem fica registrada em `mensagens` como outbound, remetente "Gael".
- Próximas interações dela já caem no fluxo correto (exemplos + regras já cadastrados na conversa anterior).

## Caso de borda
Se não houver atendimento ativo (ex: encerrado), eu uso o fallback do `responder-solicitacao` ou abro um atendimento novo via canal Evolution. Vou tratar isso na hora conforme o resultado da query.
