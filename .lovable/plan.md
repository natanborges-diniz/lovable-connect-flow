

O usuário esclareceu: a "varredura" não é pra rodar continuamente substituindo a IA. É pra **casos de recuperação** — quando o sistema fica fora do ar (desligado, falha de webhook, problema de chegada) e mensagens ficam acumuladas sem resposta. Quando voltar, precisa recuperar essas mensagens órfãs.

# Plano: Recuperação de Mensagens Órfãs (Pós-Downtime)

## Cenário

Sistema fica fora do ar (manutenção, queda de webhook, IA desligada). Cliente manda mensagem, ninguém responde. Quando o sistema volta, essas mensagens ficam "órfãs" — passaram do tempo normal de resposta e a IA não vai mais reagir naturalmente porque o debounce/contexto já passou.

## Solução: Botão "Recuperar Conversas Pendentes"

Tela em **Configurações → Recuperação de Atendimentos** com:

1. **Detecção automática**: lista atendimentos onde a última mensagem é `inbound` SEM resposta `outbound` posterior, ordenados por idade.
2. **Filtros**: idade da mensagem (>15min, >1h, >6h, >24h), setor, modo (IA/humano).
3. **Ações por atendimento** (ou em lote):
   - **▶️ Acionar IA agora** — força `ai-triage` a processar a última mensagem ignorando debounce
   - **👤 Escalar para humano** — muda modo pra `humano`, vai pra fila prioritária
   - **✉️ Enviar mensagem de desculpas** — template "Desculpe a demora, voltamos agora"
4. **Modo "Recuperação em massa"**: botão único que processa todas pendentes seguindo regra:
   - < 1h → aciona IA
   - 1h–6h → aciona IA com prefixo "Desculpe a demora!"
   - \> 6h → escala humano direto + manda template de desculpas

## Componentes

| Arquivo | Função |
|---------|--------|
| `src/pages/Configuracoes.tsx` (ajuste) | Nova aba "Recuperação" |
| `src/components/configuracoes/RecuperacaoCard.tsx` (novo) | UI: lista + filtros + ações em lote |
| `supabase/functions/recuperar-atendimentos/index.ts` (novo) | Detecta órfãos + executa ação (acionar IA / escalar / mensagem) |
| `useAtendimentosOrfaos.ts` (hook novo) | Query + invalidação realtime |

## Lógica de detecção (SQL no edge function)

```sql
-- Atendimentos com última msg inbound sem resposta posterior
SELECT a.*, contato.nome, contato.telefone,
       ultima.created_at as ultima_msg_at,
       NOW() - ultima.created_at as tempo_pendente
FROM atendimentos a
JOIN LATERAL (
  SELECT * FROM mensagens 
  WHERE atendimento_id = a.id 
  ORDER BY created_at DESC LIMIT 1
) ultima ON true
JOIN contatos contato ON contato.id = a.contato_id
WHERE a.status != 'encerrado'
  AND ultima.direcao = 'inbound'
  AND NOW() - ultima.created_at > interval '15 minutes';
```

## Ação "Acionar IA agora"

Chama `ai-triage` com flag `forcar_processamento: true` que:
- Ignora debounce de 5s
- Ignora trava de "última outbound < 10s"
- Processa última mensagem inbound como se tivesse acabado de chegar

## Ação "Escalar humano + desculpas"

1. Atualiza `atendimento.modo = 'humano'`, `prioridade = 'alta'`
2. Envia mensagem WhatsApp: *"Olá! Desculpe a demora em responder, estamos retomando seu atendimento agora. Em instantes nossa equipe vai te atender."*
3. Notifica setor responsável (badge 🔥 na fila humana)

## Onde fica na UI

- **Configurações → Recuperação de Atendimentos** (aba principal pro admin acionar manualmente após downtime)
- **Atalho no Dashboard**: card "⚠️ X conversas pendentes há mais de 1h" com link direto

## Decisões já tomadas

- ✅ Manual (admin clica), não automático — evita IA disparar em massa por engano
- ✅ Mensagem de desculpas configurável (texto editável antes de enviar em lote)
- ✅ Preview da lista antes de executar ação em massa (operador vê quem será impactado)
- ✅ Log de auditoria: registra qual ação foi tomada em cada atendimento recuperado

