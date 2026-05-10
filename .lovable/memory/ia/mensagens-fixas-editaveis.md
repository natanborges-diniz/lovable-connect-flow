---
name: Mensagens fixas editáveis (ia_mensagens_fixas)
description: Despedidas determinísticas, escalada fora-horário, pedido de receita por texto e despedida final de recuperação vivem em ia_mensagens_fixas. EFs leem com cache 60s + fallback hardcoded. Auditoria edita via tipo ajustar_mensagem_fixa (auto-aplicável).
type: feature
---

## Por quê
Tirar do código todas as mensagens disparadas de forma determinística (sem LLM) pra que a auditoria/Configurações possa reescrever sem deploy.

## Tabela
`public.ia_mensagens_fixas (chave PK, texto, descricao, variaveis text[], ativo, updated_at, updated_by)`. RLS: admin escreve, qualquer autenticado lê. Triggers: `update_updated_at_column`.

## Chaves seedadas
- `despedida_explicit_close` — vars `{nome_comma}`, `{tail}` — fim explícito ("tchau", "obrigado, era só").
- `despedida_thanks` — vars `{nome_comma}`, `{tail}` — só agradecimento.
- `despedida_short_no` — vars `{nome_comma}`, `{tail}` — "não" curto à oferta.
- `escalada_fora_horario` — vars `{nome_saud}`, `{proxima_abertura}` — escalada IA→humano fora do expediente.
- `pedir_receita_texto` — sem vars — fallback OCR falhou.
- `recuperacao_ia_despedida_final` — vars `{first_name}` — despedida em `vendas-recuperacao-cron` antes de mover pra Perdidos.

## Como o código consome
- **`ai-triage`**: helper `loadMensagensFixas(supabase)` carrega na primeira request e revalida a cada 60s. `renderMsgFixa(chave, vars)` substitui `{var}`. `MSG_PEDIR_RECEITA_TEXTO` virou `let` ressincronizado pelo loader. Fallback = `_msgFixaDefaults` (mesmo texto do seed) caso a tabela esteja indisponível.
- **`vendas-recuperacao-cron`**: helper `getMensagemFixa(supabase, chave, fallback, vars)` consulta direto antes do envio (sem cache, dispara 1x por execução).
- Todos os pontos preservam comportamento se a tabela ficar offline — usam o texto hardcoded original.

## Ciclo via auditoria
- `audit-ia-consolidar` recebe novo VETOR G no system prompt; tipo `ajustar_mensagem_fixa` (auto). Modelo deve preservar `{placeholders}` na sugestão.
- `audit-ia-aplicar-grupo` faz UPSERT em `ia_mensagens_fixas` (update se chave existe, insert caso contrário). Status do grupo vira `aplicado` (efetivamente mudou comportamento sem deploy).

## Pontos de atenção
- `alvo_id` em `ia_auditorias_acoes` é uuid → para esse tipo gravamos `null` e mantemos a chave em `payload.chave`.
- Se LLM sugerir remover `{placeholder}` essencial (ex: `{first_name}`), o texto ainda é válido mas perde personalização — futura camada de validação pode bloquear.
- Cache de 60s no `ai-triage` significa edição sai com até 1 min de delay (aceitável).
