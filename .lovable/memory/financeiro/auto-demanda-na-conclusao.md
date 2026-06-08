---
name: Auto-cria demanda na conclusão financeira sem demanda vinculada
description: concluir-solicitacao-financeiro cria demanda_loja se metadata.demanda_id está ausente, garantindo que a loja receba carta/comprovante no Messenger
type: feature
---

## Problema
Quando a loja abre fluxo financeiro (estorno/pagamento) direto pelo bot do Messenger, em alguns casos a `solicitacoes` é criada sem `metadata.demanda_id`. Antes, ao concluir, a EF apenas atualizava metadata + movia card, sem nada chegar de volta à loja.

## Fix
`concluir-solicitacao-financeiro` agora:
1. Lê `metadata.demanda_id`.
2. Se ausente, busca `telefones_lojas` por `alias_loja` e **auto-cria** uma `demandas_loja` com `tipo_chave='carta_estorno'` ou `'comprovante_pagamento'`, protocolo `FIN-AAAA-<8chars>`.
3. Faz backfill de `solicitacoes.metadata.demanda_id` para futuras interações.
4. Posta mensagem + anexo em `demanda_mensagens` e dispara notificações (`resolver_destinatarios_loja`).

Mensagem de warning quando lojaNome/telefone faltam — loja não notificada (caso extremo).
