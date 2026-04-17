---
name: Ponte Mensageria (WhatsApp ↔ Interno)
description: Regra geral para contatos com setor_destino e responsável único — espelha WhatsApp na mensageria interna; resposta interna vira WhatsApp
type: feature
---
Regra geral do sistema: contato externo com `setor_destino` cujo setor tem **um único** `setor_usuario` ativo entra automaticamente em modo **ponte**.

## Componentes
- **Tabela `contato_ponte`**: contato_id, responsavel_user_id, setor_id, conversa_id (`ponte_<contato_id>`), ativo
- **Função `setup_contato_ponte(contato_id)`**: resolve responsável único e ativa ponte. Trigger em `contatos.setor_destino` chama auto.
- **Modo `ponte`** em `atendimentos.modo`: webhook desvia pra `bridge-mensageria` em vez de ai-triage; ai-triage skipa.
- **Edge `bridge-mensageria`** com 2 direções:
  - `whatsapp_to_interno`: msg externa → mensagem interna prefixada `📲 Nome (telefone)` pro responsável
  - `interno_to_whatsapp`: msg interna do responsável → send-whatsapp pro contato
- **Trigger `on_mensagem_interna_ponte`**: dispara bridge automaticamente quando responsável envia em conversa `ponte_*`
- **Perfil "Sistema · Ponte WhatsApp"** (criado on-demand): remetente das msgs espelhadas; `ativo=false` pra não aparecer em listas

## Caso real
Diniz E-commerce (5511913171871) → Setor "Dpto Armações" → única responsável: Marilene. Msgs do WhatsApp aparecem na mensageria interna dela; respostas dela voltam pelo WhatsApp.

## Resolução de responsável
- 1 usuário ativo no setor → ponte ativada
- 0 ou >1 → ponte desativada (cai em ia/humano normal)
- Quando segundo usuário é adicionado ao setor, ponte continua com o original (não troca automaticamente)
