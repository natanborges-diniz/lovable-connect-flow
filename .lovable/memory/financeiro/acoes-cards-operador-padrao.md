---
name: Ações padrão do operador no card Financeiro
description: Padrão de 3 botões (Devolver / Aprovar-Solicitado / Concluir) com anexo obrigatório por tipo (estorno_cartao, estorno_pix_debito, pagamento, reembolso). Concluir devolve via Messenger.
type: feature
---

## Tipos cobertos
- `estorno_cartao`, `estorno_pix_debito` → ações: **Estorno solicitado** · **Concluir com carta** · **Devolver à loja**
- `pagamento`, `reembolso` → ações: **Concluir pagamento** · **Devolver à loja**

## Conclusão (edge function `concluir-solicitacao-financeiro`)
- Modo `carta` → upload obrigatório (PDF/imagem) da carta de devolução. Marca `metadata.estorno_status='concluido'` + `carta_estorno_url`.
- Modo `comprovante_pagamento` → upload + NSU + valor obrigatórios. Marca `metadata.payment_status='PAGO'` + `nsu/tid/valor_pago/comprovante_url`.
- Move card para coluna **Concluído** do setor Financeiro.
- Espelha mensagem na thread Messenger via `demanda_mensagens` (`direcao=operador_para_loja`) com `anexo_url`. Cria notificação para usuários da loja via `resolver_destinatarios_loja`.

## Botão "Estorno solicitado"
Atualização inline em `PipelineFinanceiro.tsx`: setta `metadata.estorno_status='solicitado'` + posta msg "✅ Estorno foi solicitado à adquirente. Aguardando retorno." na thread Messenger. Não move card (segue em "Estorno Solicitado").

## Devolver à loja
Reaproveita `devolver-solicitacao-loja` (sem mudanças no backend). Front passa `presets` por tipo:
- Estornos: `["NSU incorreto","Valor divergente","Falta carta do cliente","Outro"]`
- Pagamento: `["Falta CNPJ do favorecido","Chave PIX inválida","Anexo ilegível","Valor divergente","Outro"]`
- Reembolso: `["Comprovante ilegível","Chave PIX inválida","Valor divergente","Outro"]`

## Bucket
Anexos de conclusão vão para bucket público `mensagens-anexos` em `financeiro/{solicitacao_id}/{timestamp}-{modo}.{ext}`.

## Etapas dos fluxos no Messenger (`bot_fluxos.etapas`)
- `estorno_cartao`: numero_venda, data_processamento, nsu, valor_total, valor (a cancelar), motivo.
- `estorno_pix_debito`: numero_venda, data_processamento, nsu, valor_total, valor, motivo, banco.
- `pagamento`: favorecido, documento_favorecido (CNPJ/CPF), valor, vencimento, forma_pagamento, dados_pagamento, descricao, loja_ou_setor, anexo_nota (imagem obrig.).
- `reembolso`: + forma_reembolso + chave_pix além das etapas anteriores.

`link_pagamento` fica intocado — funciona como está.
