---
name: Branding voltado ao cliente final
description: Cliente final só vê "Óticas Diniz". "Atrium" é nome interno do app B2B e nunca aparece em mensagens, templates, prompts ou e-mails enviados a clientes.
type: constraint
---

## Regra

Toda comunicação **voltada ao cliente final** (mensagens WhatsApp, templates Meta, respostas da IA, e-mails transacionais, assinaturas, comprovantes, picotes) deve assinar como **"Óticas Diniz"** (ou variações como "Equipe Óticas Diniz").

**Nunca** usar "Atrium", "Equipe Atrium" ou similares em conteúdo que chega ao cliente.

## Onde "Atrium" PODE aparecer (uso interno legítimo)

- Nome do app de mensageria B2B: **"App Atrium Messenger"** (lojas, colaboradores, setores).
- UI interna do operador (ex.: `CanalUnicoCard`, configurações).
- Comentários de código, logs, documentação técnica.
- Redirect de SSO (`atrium-link.lovable.app`) — domínio técnico, não exibido ao cliente.
- Memórias e arquitetura do projeto.

## Pontos de checagem ao criar conteúdo novo

1. **Templates WhatsApp** (`whatsapp_templates.body`) — sempre "Óticas Diniz".
2. **Prompts da IA** (`configuracoes_ia`, `conhecimento_ia`, `ia_exemplos`, `ia_regras_proibidas`, `ia_feedbacks.resposta_corrigida`) — sempre "Óticas Diniz".
3. **Edge functions que enviam ao cliente** (`send-whatsapp`, `send-whatsapp-template`, `recuperar-atendimentos`, `vendas-recuperacao-cron`, `agendamentos-cron`, `ai-triage`, `payment-webhook` quando responde cliente) — sempre "Óticas Diniz".
4. **E-mails de auth** (reset de senha, confirmação) — assinar como "Óticas Diniz".

## Por que

A aplicação interna se chama Atrium, mas a marca do negócio é **Óticas Diniz**. Cliente final não conhece nem deve conhecer "Atrium".
