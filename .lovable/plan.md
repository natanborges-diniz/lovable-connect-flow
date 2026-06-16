## Diagnóstico (revisado para cobrir devoluções)

A tabela `public.notificacoes` só tem policy de INSERT para `service_role`. Qualquer `supabase.from("notificacoes").insert(...)` feito do navegador é silenciosamente bloqueado por RLS (sem `.select()`, o erro nem chega ao toast). Além disso, há fluxos de devolução à loja que **não usam a infraestrutura oficial** (`devolver-solicitacao-loja` EF + `demanda_loja` em `aguardando_complemento` + trigger `trg_demanda_resposta_reentrada` que reabre o card quando a loja responde).

### Inventário completo dos retornos do setor Financeiro

| Fluxo | Origem | Notifica loja? | Reabre card no retorno? | Status |
|---|---|---|---|---|
| Confirmar PIX | `ConfirmarPixDialog.tsx` (client) | `notificacoes.insert` direto | n/a (conclusivo) | **quebrado (RLS)** |
| Solicitar Autorização (CPF) | `SolicitarAutorizacaoDialog.tsx` (client) | 2× `notificacoes.insert` direto | n/a | **quebrado (RLS)** |
| Concluir Solicitação (comprovante/estorno) | EF `concluir-solicitacao-financeiro` | server-side service_role | n/a (encerra) | OK |
| "Devolver à loja" genérico | `DevolverLojaDialog` → EF `devolver-solicitacao-loja` | server-side + cria `demanda_loja` `aguardando_complemento` + push | **sim**, via `trg_demanda_resposta_reentrada` | OK |
| Aprovar / Reprovar CPF | `CpfApprovalDialog.tsx` | depende de automação de coluna (`pipeline-automations`) | n/a | **lacuna**: sem garantia de mensagem à loja |
| **Dados Incompletos (CPF)** | `CpfApprovalDialog.tsx` | só move coluna + `eventos_crm`. **Não chama `devolver-solicitacao-loja`, não cria `demanda_loja`** | **NÃO** — loja não tem canal para responder e card não reabre sozinho | **furo grave no fluxo de devolução** |
| Criar card manual | `CreateCardDialog.tsx` (client) | `notificacoes.insert` direto | n/a | **quebrado (RLS)** |

## Plano

### 1. Migration — destravar INSERT em `notificacoes` para `authenticated`
```sql
CREATE POLICY "Authenticated can create notifications"
ON public.notificacoes FOR INSERT TO authenticated
WITH CHECK (usuario_id IS NOT NULL OR setor_id IS NOT NULL);
```

### 2. Frontend defensivo — propagar erros silenciosos
Adicionar `.select()` + `toast.error` em todos os call sites client-side que inserem `notificacoes`/`solicitacao_comentarios`:
- `ConfirmarPixDialog.tsx`
- `SolicitarAutorizacaoDialog.tsx` (2 inserts)
- `CreateCardDialog.tsx`

### 3. **Refatorar "Dados Incompletos" para usar o fluxo oficial de devolução**
No `CpfApprovalDialog.tsx`, no branch `dados_incompletos`, substituir o `update` direto + `eventos_crm` pela invocação de `devolver-solicitacao-loja` com:
- `solicitacao_id`, `coluna_destino_id` (Dados Incompletos)
- `assunto`: "Dados incompletos — CPF SOL-XXXX"
- `pergunta`: lista dos campos faltantes + observação livre do operador
- `tipo_chave`: `cpf_dados_incompletos` (novo) para o `DemandaThreadView` saber renderizar
- Mantém o upload do print de consulta como anexo da demanda.

Ganhos automáticos: (a) loja recebe sino + push via `trg_push_demanda_loja_nova_fn`, (b) quando a loja responde no app, `trg_demanda_resposta_reentrada` move o card de volta para a coluna de revisão (`reentrada_revisao` no setor Financeiro) e dispara `notificacao` de "demanda_resposta" para o solicitante. Sem reabertura manual.

### 4. Garantir notificação no Aprovar/Reprovar CPF
Mesmo confiando no `pipeline-automations`, adicionar notificação explícita (via `resolver_destinatarios_loja`) no `CpfApprovalDialog.tsx` para os 2 desfechos terminais, com referência ao SOL e link `/loja/demandas?sol=...`. Evita depender de a automação de coluna estar configurada corretamente.

### 5. Setor Financeiro — criar coluna `reentrada_revisao`
Verificar via `read_query` se o setor Financeiro já tem uma `pipeline_colunas.tipo_acao = 'reentrada_revisao'`. Se não tiver, migration para criá-la (mesmo padrão dos demais setores) — sem isso a reabertura automática do trigger não tem destino.

### 6. Sanity sweep
`rg "from\(\"notificacoes\"\)\.insert" src/` para garantir que todos os call sites ganharam `.select()` + tratamento de erro. Documentar regra na memória do projeto: **inserts client-side em `notificacoes` devem usar `.select()`**.

### 7. Backfill da SOL-2026-00066
Inserir manualmente a notificação perdida da confirmação de PIX para o destinatário da loja Diniz Carapicuíba.

## Fora de escopo
- Reescrever `pipeline-automations`.
- Mexer em fluxos do CPF que já funcionam (consulta, anexo de print).

## Resultado esperado
- Toda movimentação que precisa de retorno da loja entra via `demanda_loja` → loja recebe no Atrium (sino+push), responde no app, card volta sozinho.
- Movimentações conclusivas (PIX confirmado, autorização concedida, CPF aprovado/reprovado) sempre criam linha em `notificacoes` que dispara push pelo trigger.
- Qualquer falha futura aparece em toast em vez de sumir.
