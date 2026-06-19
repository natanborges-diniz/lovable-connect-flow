## Problema

No caso da Dayane, o atendimento foi escalado para humano às 16:32, mas nenhum operador respondeu. Mesmo assim, 4h depois (~20:45) o cron `vendas-recuperacao-cron` disparou `retomada_contexto_1` em nome do "Sistema". A cliente reagiu reclamando ("nem falei com ninguém, péssimo atendimento"), e ainda recebeu **um segundo** `retomada_contexto_1` depois da resposta da IA — confundindo ainda mais.

Causa: a função `processHumano` (linhas 540-770 de `vendas-recuperacao-cron/index.ts`) só checa cooldown **se** existir outbound humano. Quando nunca houve interação humana, ela passa direto e dispara o template como se fosse "retomada" de uma conversa que nunca aconteceu.

## Correção

Adicionar um **gate de pré-condição** em `processHumano`: só executar a cadência de retomada se já existir pelo menos **uma mensagem outbound de operador humano real** no atendimento. Sem isso, o "retomar contexto" é mentira.

### Mudanças

**`supabase/functions/vendas-recuperacao-cron/index.ts` — função `processHumano`**

Logo após calcular `lastOutbound` (linha ~593) e antes do bloco de cooldown, adicionar:

```ts
const houveInteracaoHumana = (lastOutbound || []).some((m: any) => {
  const nome = String(m.remetente_nome || "").toLowerCase();
  return nome && !/gael|assistente|sistema|template|bot|ia\b|recupera/i.test(nome);
});

if (!houveInteracaoHumana) {
  // Atendimento escalado mas operador ainda não respondeu —
  // não faz sentido mandar "retomada de contexto". Mantém apenas
  // o alerta de inatividade interno (notificacoes) já gerado acima.
  console.log(`[HUMANO-SKIP] ${contato.nome}: nenhum operador interagiu ainda — pulando retomada`);
  return result;
}
```

Esse gate:
- Mantém o alerta interno (`notificacoes` tipo `inatividade_humano`) que já é emitido antes — o time continua sendo cobrado.
- Bloqueia tanto a tentativa 1 quanto a despedida final (a despedida `retomada_despedida` também não faz sentido sem nenhuma interação humana prévia).
- Como o `lastOutbound` busca os últimos 10 outbounds, cobre os casos reais de handoff (1ª mensagem humana é o gatilho legítimo para a cadência).

### O que NÃO muda

- Cadência IA (`processIA`) continua igual — não estava envolvida.
- Cooldown humano de 24h após resposta do consultor continua igual.
- Despedida e movimento para "Perdidos" continuam disparando normalmente **depois** que o operador interagiu pelo menos uma vez.
- Alertas internos de inatividade para a equipe seguem funcionando — eles é que devem cobrar o operador, não um template para o cliente.

## Resultado esperado

Atendimentos escalados que ficam "órfãos" (operador nunca respondeu) deixam de receber `retomada_contexto_*`. A pressão volta para onde deve estar: notificação interna ao time. Quando o operador finalmente mandar a 1ª mensagem, a cadência de retomada passa a valer normalmente caso o cliente suma depois.
