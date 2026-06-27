## Ajuste — flag "Imprimir" é só sinal da loja, sem ação sistêmica

### Entendimento confirmado
- `boleto_impresso` é decidido pela **loja na abertura** do pedido de boleto (wizard no Messenger).
- No Financeiro é **apenas um aviso visual** ("essa loja quer impresso, vai por malote") — o sistema não muda fluxo, não cria tarefa, não notifica diferente.
- O Financeiro anexa o(s) boleto(s) e conclui, ponto. Quem imprime e despacha por malote é a operação interna, fora do sistema.

### O que muda no Atrium

1. **`ConcluirSolicitacaoDialog.tsx`** — remover o checkbox "Imprimir e entregar fisicamente" do modo `boleto`. O dialog volta a ter só: anexo(s) múltiplo(s) + observação.
   - Remover state `boletoImpresso`, label, bloco do checkbox e parâmetro `boleto_impresso` do payload.
   - Remover trecho "(sinalizado para impressão)" do toast de sucesso.

2. **EF `concluir-solicitacao-financeiro`** — parar de ler/gravar `boleto_impresso` na conclusão (o valor que vale é o que a loja já gravou na abertura). Nenhuma migration; o campo continua existindo em `metadata` vindo de `criar-solicitacao-loja`.

3. **`PipelineFinanceiro.tsx`** — manter o badge `🖨️ Imprimir` / `📱 Digital` no card e no bloco "picote" do detalhe, mas a fonte é sempre `metadata.boleto_impresso` setado **na abertura**. Texto do badge ajustado para deixar claro que é pedido da loja:
   - Card: `🖨️ Loja pediu impresso (malote)` ou `📱 Digital`
   - Detalhe (linha "Entrega"): `Imprimir e enviar por malote (solicitado pela loja)` ou `Digital — anexar PDF`

### Instrução para o Messenger (projeto separado)
O wizard de Gerar Boleto **continua** coletando o toggle `boleto_impresso` no passo de condições — é lá que ele faz sentido. Apenas o **diálogo de conclusão do Financeiro** perde a opção, porque a decisão já veio pronta da loja.

### Build/teste
- TS check no Atrium após remover o estado.
- Abrir um card de boleto de teste: verificar que badge reflete o que a loja marcou na abertura e que o dialog de conclusão não pergunta mais.

Sem migrations, sem novas tabelas, sem mexer em cron.