## Painel "Receita lida pelo Gael" — só aparece em faixa alta de grau

Hoje o operador vê o badge âmbar "⚠ Revisar orçamento" no header do atendimento, mas não consegue conferir os valores da receita que o Gael leu via OCR e o cliente confirmou. Vamos trazer essa visibilidade direto no painel — **mas só nos casos em que a IA marcou revisão humana pendente** (faixa alta: `cilindrico_alto`, `adicao_alta`, `esferico_faixa_cinza`). Receitas em faixa normal continuam fluindo sem nenhum overhead na UI.

### Gate de exibição

O botão e o popover **só renderizam** quando:
```
atendimento.metadata.revisao_humana_pendente === true
```

Para receitas em faixa normal (a grande maioria) nada muda — sem botão, sem popover, sem ruído visual. O operador só vê o painel quando o Gael sinalizou que aquele grau exige validação humana.

### Onde os dados já estão

`contatos.metadata.receitas[]` (até 5 leituras). Cada item tem:
- `eyes.od` / `eyes.oe` — `{ esf, cyl, axis, add }`
- `rx_type`, `confidence`, `data_leitura`, `confirmed_by_client_at`, `label`
- `summary.suggested_category`

E `metadata.receita_confirmacao` traz `rx_index`, `pending`, `confirmed_at`.

A IA já grava `revisao_motivos[]` em `atendimentos.metadata` quando bate uma das três faixas críticas.

### Mudanças

**1. Novo `src/components/atendimentos/ReceitaValidacaoPopover.tsx`**

- Renderiza `null` se `!revisao_humana_pendente` (gate de segurança extra).
- Cabeçalho: label da receita + timestamp + tag de tipo (Visão simples / Multifocal).
- Cartões OD / OE com ESF, CIL, EIXO, ADD formatados em pt-BR (sinais e graus).
- Linha de motivos da revisão (reusa `traduzirMotivos`): "Cilíndrico alto (>4) • Adição alta (>3,5)".
- Status de confirmação do cliente: ✅ "Confirmada em DD/MM HH:mm" ou ⏳ "Aguardando confirmação".
- Confiança da extração (`confidence × 100%`) em barrinha discreta.
- Se houver mais de uma receita em `receitas[]`, Tabs simples para alternar.
- Rodapé com dois botões:
  - **"Validar e liberar orçamento"** → limpa `revisao_humana_pendente` + `revisao_motivos`, registra `eventos_crm` `tipo: 'orcamento_revisao_validada'` com `user_id`, motivos originais e snapshot da receita validada. Toast "Receita validada".
  - **"Pedir nova leitura"** → marca `receita_confirmacao.pending=true`, incrementa `correction_count`, registra `eventos_crm` `tipo: 'orcamento_revisao_rejeitada'`. Não envia mensagem ao cliente.

**2. `src/pages/Atendimentos.tsx`**

- No header do detalhe, **substituir** o botão "Resolver" atual por um botão **"📄 Receita lida"** (com ping âmbar discreto) que abre o popover. O badge "⚠ Revisar orçamento" continua visível ao lado, sinalizando o estado.
- Renderização condicionada a `revisao_humana_pendente === true` — receitas em faixa normal não mostram o controle.
- Estender `useAtendimento` em `src/hooks/useAtendimentos.ts` para trazer `contato:contatos(*)` (precisa de `metadata.receitas` e `receita_confirmacao`).

**3. `src/components/shared/RevisaoHumanaBadge.tsx`**

- Exportar helper `formatRx(eye)` → `"ESF -1,00 CIL -5,50 EIXO 40°"` para reúso.

### Sem mudanças

- Schema (tudo já em `contatos.metadata` / `atendimentos.metadata`).
- `ai-triage` (lógica de leitura/classificação intacta).
- Lista (tabela) — mantém só o badge âmbar pequeno.

### Memória

Atualizar `mem://ia/regras-negocio-e-proibicoes-criticas`: validação humana da receita acontece **apenas em faixa alta de grau** (motivos `cilindrico_alto`, `adicao_alta`, `esferico_faixa_cinza`) via popover "📄 Receita lida" no detalhe do atendimento. `orcamento_revisao_validada` é a fonte de verdade da validação.

### Arquivos tocados

- `src/components/atendimentos/ReceitaValidacaoPopover.tsx` (novo)
- `src/pages/Atendimentos.tsx` (botão condicional + integração)
- `src/hooks/useAtendimentos.ts` (select estendido em `useAtendimento`)
- `src/components/shared/RevisaoHumanaBadge.tsx` (export `formatRx`)
- `mem://ia/regras-negocio-e-proibicoes-criticas` (escopo da validação)
