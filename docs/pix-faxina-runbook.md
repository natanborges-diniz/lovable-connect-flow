# Pix — Runbook da faxina pós-piloto

Estado oficial em produção (31/07/2026): Messenger → `criar-solicitacao-loja-v8` (Atrium) → `pix-charges-v4` (OB, criação) · página `/pix/:id` → `pix-charges-v5` (confirmação com guarda atômica) · template Meta `pix_pagamento_cliente_v2`.

Lição da saga: neste pipeline, **atualização de edge function existente não substitui o artefato publicado** — só função com nome novo publica confiável. Toda mudança de função = nome novo + repontar o chamador.

## Colagens no Lovable (ordem sugerida)

### 1. Connect & Flow — publicar o webhook com dedup Pix
> Deploy da function NOVA payment-webhook-v2 (commit 9128ea6). Não altere nenhum arquivo.

### 2. Infoco Optical Business — apontar as notificações pro webhook novo (só depois do passo 1)
> No Supabase deste projeto, crie/atualize o secret ATRIUM_WEBHOOK_URL com o valor https://kvggebtnqmxydtwaumqz.supabase.co/functions/v1/payment-webhook-v2. Não altere código.

### 3. Connect & Flow — corrigir a vilã original (qualquer hora)
> No Supabase deste projeto, atualize o secret OPTICAL_BUSINESS_URL para exatamente https://zmsfntqgxsstnbpzdled.supabase.co — hoje ele contém um caminho de function embutido, que roteava as chamadas Pix para a function errada. Não altere código.

Seguro em qualquer ordem: a v8 extrai o host da variável e funciona com ela certa ou errada; o fluxo de cartão passa a usar a URL correta.

### 4. (Opcional) Faxina dos clones da batalha
**Connect & Flow:**
> Apague as edge functions criar-solicitacao-loja-v2, criar-solicitacao-loja-v3, criar-solicitacao-loja-v4, criar-solicitacao-loja-v5, criar-solicitacao-loja-v6 e criar-solicitacao-loja-v7. Mantenha criar-solicitacao-loja e criar-solicitacao-loja-v8. Não altere arquivos.

**Infoco Optical Business:**
> Apague as edge functions pix-charges-v2 e pix-charges-v3. Mantenha pix-charges, pix-charges-v4 e pix-charges-v5. Não altere arquivos.

(Os diretórios clones no GitHub podem ser removidos depois num commit de limpeza — pedir ao Claude.)

## Rollout das demais lojas (sem Lovable)
Tela **BTG Validação** do OB, por empresa: **Re-autorizar** (login BTG do CNPJ; selo deve virar "Setup completo") + cadastrar a **chave Pix** no campo 💠. Loja sem setup recebe erro claro na geração — liberar aos poucos é seguro.

## Pendências conhecidas (não bloqueiam)
- Webhook BTG (`btg-webhook`) e polling (`btg-poll-status`) têm artefatos antigos sem o ramo Pix; a confirmação hoje vem da verificação on-demand da página `/pix` (segundos, com a página aberta). Cobrança não paga e nunca aberta só expira quando alguém abre a página — se isso incomodar, criar um cron/função nova apontando pra `pix-charges-v5` action `verificar`.
- Unificação futura: fazer a criação também na v5 (hoje criar=v4, confirmar=v5) num único nome definitivo, atualizando o chamador no Atrium.
