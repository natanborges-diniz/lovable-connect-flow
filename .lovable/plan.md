

## Diagnóstico

Auto-routing atual ainda exige `#NN` em alguns casos (múltiplas demandas) e não trata mídia/foto. Solução: enquanto há demanda aberta pra loja, **TODA** mensagem dela (texto, foto, áudio, vídeo) vai pra thread automaticamente. Sem prefixo, sem bot, sem IA.

## Plano

### 1. Auto-routing absoluto (sem `#NN`)
`whatsapp-webhook` → `routeDemandaResposta`:
- Se loja tem **qualquer** demanda aberta → roteia automaticamente pra mais recente.
- Funciona pra texto, imagem, áudio, vídeo, documento (todos os tipos vão pra `demanda_mensagens` com `tipo_conteudo` e `anexo_url`).
- Remove a lógica de prefixo `#NN` (não precisa mais — só uma demanda ativa por vez é a regra prática; se houver múltiplas, sempre a mais recente).
- Mantém comando especial `#encerrademanda` (loja força encerramento).
- Remove comando `menu` como escape — enquanto demanda aberta, loja não acessa bot. Pra acessar bot, precisa encerrar primeiro.

### 2. Comando `#encerrademanda` pela loja
Em `routeDemandaResposta`, se texto = `#encerrademanda` (case-insensitive, trim):
- Chama `encerrar-demanda-loja` com `encerrado_por='loja'`.
- WA pra loja: *"✅ Demanda DEM-AAAA-NNNNN encerrada por você. Para nova solicitação, digite menu."*
- Notifica operador via `notificacoes`: "Loja X encerrou a demanda DEM-NNNNN".

### 3. Auto-encerramento por inatividade (30min)
Nova edge function `auto-encerrar-demandas` + cron job a cada 5min:
- Busca `demandas_loja` com `status IN ('aberta','respondida')` e `updated_at < now() - 30min`.
- Encerra cada uma chamando lógica de `encerrar-demanda-loja` com `encerrado_por='auto'`.
- WA pra loja: *"⏰ Demanda DEM-AAAA-NNNNN encerrada automaticamente por inatividade (30min). Para nova solicitação, digite menu."*
- Nota sistema na thread + notifica operador.

Cron via `cron_jobs` (UI gerenciada):
```sql
SELECT cron.schedule('auto-encerrar-demandas', '*/5 * * * *',
  $$SELECT net.http_post(url:='.../auto-encerrar-demandas', ...)$$);
```

### 4. Mensagens padronizadas pra loja
Centralizar em `encerrar-demanda-loja` com switch por `encerrado_por`:
- `operador`: "✅ Demanda {protocolo} encerrada pelo operador. Obrigado! Para nova solicitação, digite menu."
- `loja`: "✅ Demanda {protocolo} encerrada por você. Para nova solicitação, digite menu."
- `auto`: "⏰ Demanda {protocolo} encerrada automaticamente por inatividade (30min). Para nova solicitação, digite menu."

Todas via Evolution (`force_provider='evolution_api'`).

### 5. Atualizar memory
`mem://bot-lojas/canal-demandas-privado.md`:
- Auto-routing absoluto (sem prefixo, todos os tipos de mídia).
- `#encerrademanda` como única forma da loja sair.
- Auto-encerramento 30min.
- Bot/IA bloqueados enquanto demanda aberta.

## Arquivos afetados

- `supabase/functions/whatsapp-webhook/index.ts` — `routeDemandaResposta` simplificado: roteia tudo, suporta mídia, detecta `#encerrademanda`, remove escape `menu`.
- `supabase/functions/encerrar-demanda-loja/index.ts` — aceita `encerrado_por` (`operador|loja|auto`), mensagens diferenciadas, notificação ao operador quando loja/auto encerra.
- `supabase/functions/auto-encerrar-demandas/index.ts` — **nova**: scan + encerra por inatividade.
- Migration: criar cron job `auto-encerrar-demandas` a cada 5min via `cron.schedule` + entry em `cron_jobs`.
- `mem://bot-lojas/canal-demandas-privado.md` — atualizar regras.

## Resultado

Operador abre demanda → conversa fica privada com a loja (texto/foto/áudio tudo vai pra thread) → operador encerra OU loja envia `#encerrademanda` OU sistema encerra após 30min sem atividade → loja recebe confirmação → próxima msg cai no bot-lojas normal.

