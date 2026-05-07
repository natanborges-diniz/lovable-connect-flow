---
name: Regras de negócio e proibições críticas
description: Regras-mestre de produto da IA (exames, foto, receita) + UI de validação humana de receita em /crm/conversas
type: feature
---

# Regras de negócio críticas

- Não realizamos exames médicos na loja — sempre direcionar para parceiros.
- Sempre priorizar visita à loja para fechamento.
- Foto da receita é necessária para orçamentos de óculos.

## Validação humana de receita (faixa alta apenas)

A IA só sinaliza `revisao_humana_pendente=true` em `atendimentos.metadata` quando a receita cai numa das três faixas críticas (`cilindrico_alto` >4, `adicao_alta` >3,5, `esferico_faixa_cinza` 8–10). Receitas em faixa normal seguem cotação automática sem nenhum overhead.

### UI em /crm/conversas (detalhe do atendimento)

Quando `revisao_humana_pendente === true`, o header mostra:
1. Badge âmbar `⚠ Revisar orçamento` (com motivos no tooltip).
2. Botão `📄 Receita lida` (com ping âmbar) que abre o popover `ReceitaValidacaoPopover`.

O popover exibe OD/OE formatados (`formatRx`), tipo da lente, motivos da revisão, status de confirmação do cliente, confiança da extração, e suporte a múltiplas receitas via Tabs.

Duas ações:
- **Validar e liberar orçamento** → remove `revisao_humana_pendente`/`revisao_motivos` de `atendimentos.metadata`, registra `eventos_crm` `tipo: 'orcamento_revisao_validada'` com snapshot da receita. Fonte de verdade da validação humana.
- **Pedir nova leitura** → marca `contatos.metadata.receita_confirmacao.pending=true`, incrementa `correction_count`, registra `eventos_crm` `tipo: 'orcamento_revisao_rejeitada'`. Não envia mensagem ao cliente.

Receitas em faixa normal não exibem botão nem popover.
