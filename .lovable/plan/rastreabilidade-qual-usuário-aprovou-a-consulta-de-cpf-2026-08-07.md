# Rastreabilidade: qual usuário aprovou a Consulta de CPF

## Diagnóstico (verificado no banco)

Na consulta SOL-2026-00190 (Lucineide, DINIZ PRIMITIVA II) os dados gravados na aprovação são apenas:
`resultado_consulta: aprovado`, `data_analise: 01/08 16:47`, `justificativa_interna: "Aprovado!"`.

Não há usuário em lugar nenhum:
- o comentário de retorno à loja foi inserido com `autor_nome: "Financeiro"` e `autor_id` vazio (por isso o Messenger mostra só o setor, enquanto a mensagem do Natan tem autor real);
- não há evento em `pipeline_card_eventos` para essa solicitação;
- o evento em `eventos_crm` também não guarda usuário.

Ou seja: hoje o sistema simplesmente não registra quem aprovou/reprovou. Para os casos passados esse dado não existe e não pode ser recuperado.

## O que fazer

1. **Gravar o analista na aprovação/reprovação**
   Ao clicar em Aprovar ou Reprovar, gravar no `metadata` da solicitação: `analista_id`, `analista_nome`, junto do `data_analise` já existente.

2. **Assinar o retorno à loja com o usuário**
   O comentário enviado à loja passa a ter `autor_id` do usuário logado e `autor_nome` no formato `Financeiro · Natan Borges`, para que o diálogo da loja mostre quem decidiu.

3. **Evento na timeline do card**
   Registrar em `pipeline_card_eventos` um evento `cpf_aprovado` / `cpf_reprovado` com usuário, data e resultado — fica no histórico do card mesmo que o metadata mude depois.

4. **Exibir na interface**
   - No badge verde "CPF Aprovado em 01/08 16:47" do dialog: acrescentar `· por {analista_nome}`.
   - Na linha de origem do card de boleto (picote): `Consulta CPF — SOL-2026-00190 · aprovada em 01/08 por {analista_nome}`.
   - Quando não houver analista registrado (casos anteriores a esta mudança): mostrar "analista não registrado (legado)".

5. **Revalidar a alteração anterior**
   Remover o bloco "Responsável / Assumir / Liberar" adicionado no detalhe do card do Financeiro (Mesa e Kanban) — não era o que foi pedido. A rastreabilidade passa a ser automática, sem ninguém precisar assumir nada.

## Detalhes técnicos

- `src/components/financeiro/CpfApprovalDialog.tsx`: incluir `analista_id`/`analista_nome` no `updatedMetadata`, assinar o comentário, inserir o evento de timeline, exibir o nome no badge.
- `src/components/financeiro/BoletoConsultaOrigem.tsx`: ler `analista_nome` do metadata da consulta e exibir.
- `src/pages/MesaFinanceiro.tsx` e `src/pages/PipelineFinanceiro.tsx`: remover uso de `ResponsavelSolicitacao` e apagar o componente.
- `src/components/pipeline/CardTimeline.tsx`: ícones/cores para os tipos `cpf_aprovado` e `cpf_reprovado`.
- Sem migration: tudo usa colunas e tabelas existentes.
