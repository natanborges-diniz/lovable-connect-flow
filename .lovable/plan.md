## Boleto: anexo extra + guarda obrigatória na conclusão

### Parte A — Guarda "sem anexo = não envia" (corrigir o bug que aconteceu hoje)

Hoje o card foi para "Boleto Enviado" sem arquivo. Causa provável: `concluir-solicitacao-financeiro` no modo `boleto` aceitou payload com `anexos: []` (ou request sem upload concluído) e mesmo assim moveu o card. O front (`ConcluirSolicitacaoDialog`) já valida `files.length > 0`, mas o backend não bloqueia.

**Correções:**
- **EF `concluir-solicitacao-financeiro`** (modos `boleto` e `boleto-revisao`):
  - Validar `Array.isArray(anexos) && anexos.length > 0`; cada item precisa ter `url` e `storage_path` não vazios.
  - Se falhar → retornar 400 `"Anexe pelo menos 1 arquivo de boleto antes de concluir."` **antes** de qualquer update no card.
  - Log em `pipeline_card_eventos` com `tipo='boleto_envio_bloqueado'` quando bloquear (para auditoria).
- **`ConcluirSolicitacaoDialog.tsx`**: já bloqueia, mas adicionar guarda extra — desabilitar o botão durante o upload (já faz) **e** não permitir click se algum upload retornou erro silencioso (rejeitar promise no `try` já cobre; reforçar com toast caso `anexos.length === 0` após o loop).
- **Backfill / auditoria**: rodar `read_query` para listar cards em "Boleto Enviado" sem `metadata.boleto_arquivos` → reportar para o usuário decidir (mover de volta para "Aguardando Boleto" ou anexar manual via Parte B).

### Parte B — Anexar arquivos depois do boleto enviado (complemento, não substituição)

Mesmo com a guarda, às vezes o financeiro precisa mandar 1 PDF a mais (segunda via, comprovante de envio, etc.). Liberar isso sem gastar ciclo de revisão.

**Backend:**
- Nova EF **`anexar-boleto-extra`** (Financeiro):
  - Recebe `solicitacao_id` + `anexos[]` (≥1) + `observacao?`.
  - Valida coluna "Boleto Enviado" ou "Boleto em Revisão" e `metadata.boleto_status === 'enviado'`.
  - Append em `metadata.boleto_arquivos[]` e registra em `metadata.boleto_anexos_historico[]` com `{tipo: 'extra', enviado_em, urls[]}`.
  - **Não** muda coluna, **não** zera `entrou_terminal_em`.
  - Espelha mensagem na thread Messenger ("📎 Arquivo adicional do boleto") e notifica loja.
  - Evento `boleto_anexo_extra` em `pipeline_card_eventos`.

**Frontend (Atrium):**
- `PipelineFinanceiro.tsx` — botão **"Anexar arquivo ao boleto"** no dialog, visível quando `boleto_status === 'enviado'`.
- Novo `AnexarBoletoExtraDialog.tsx` (input multiple + observação).
- Lista de anexos no dialog separa "Originais" / "Adicionais".
- `CardTimeline.tsx` — ícone 📎 para `boleto_anexo_extra` e ⛔ para `boleto_envio_bloqueado`.

### Instruções para o Messenger
- Renderizar mensagens com tag "📎 Arquivo adicional do boleto" como anexo extra (badge cinza "complemento"), mesma UI dos arquivos originais.
- Sem ação nova da loja — só receber.

### Regras
- Anexo extra: sem limite, enquanto card não arquivado/cancelado.
- Substituição completa → continua via ciclo de revisão (max 3).
- Conclusão de boleto: **bloqueada server-side** sem anexo.
