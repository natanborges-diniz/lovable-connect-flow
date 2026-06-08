---
name: Criação Manual de Solicitação
description: Transferências manuais CRM → Financeiro/TI passam por edge function que valida campos, grava autor (created_by), gera protocolo e evento
type: feature
---

# Criação Manual de Solicitação (Transferir para Financeiro/TI)

Quando o operador usa `TransferPipelineDialog` no CRM para mover um contato para Financeiro ou TI, o frontend chama a edge function **`criar-solicitacao-manual`** em vez de inserir direto na tabela.

## Regras
- **Validação obrigatória:** `assunto ≥ 3 chars`, `tipo` da whitelist, `descricao ≥ 5 chars`, `coluna_destino_id`.
- **Tipos válidos:**
  - Financeiro: `pagamento`, `reembolso`, `cobranca`, `estorno_cartao`, `estorno_pix_debito`, `outro`.
  - TI: `impressoes`, `suporte`, `equipamento`, `outro`.
- **Autoria:** grava `solicitacoes.created_by = auth.uid()` (coluna adicionada via migration; FK em `auth.users`).
- **Protocolo:** gera via `nextval_protocolo` no padrão `SOL-AAAA-NNNNN`, mesma função usada pelo `bot-lojas`.
- **Evento:** insere em `pipeline_card_eventos` (`entidade='solicitacao'`, `tipo='criacao_manual'`) com autor + protocolo, para rastreio idêntico ao fluxo do bot.
- **canal_origem:** `manual_operador` (substitui o antigo `sistema` que era genérico demais).
- **metadata:** `{ origem_manual: true, aberto_por, aberto_por_nome, destino_pipeline, contato_nome }`.

## Por que existe
O insert direto via client (legado) criava cards "magros" sem protocolo, sem evento, sem autor e sem metadata — exatamente o caso do card "Pagamento Online" do Gean (id `4ed36314…`, deletado em 08/06/2026). Agora todo caminho de criação (bot ou manual) gera card auditável.
