
Usuário aponta 3 erros graves do Gael nesta conversa:

1. **"Passagem"** foi interpretada como transporte/deslocamento — quando no contexto óptico significa **trocar/passar a lente atual de um óculos para outra armação** (serviço de montagem).
2. **Para passagem NÃO se pede receita** — as lentes já existem, o cliente só quer remontá-las.
3. **Receita só é exigida quando o cliente quer comprar/fabricar lentes novas** (orçamento de lentes).

Preciso ensinar isso ao Gael de forma persistente. O sistema já tem infraestrutura pronta:
- `ia_regras_proibidas` (regras absolutas)
- `ia_exemplos_modelo` (few-shot)
- `compile-prompt` injeta tudo no prompt
- UI em Configurações → Aprendizado para gerenciar

Não preciso mudar código — só inserir registros via migration. Já está tudo plugado.

## Plano

### 1. Glossário óptico (regra proibida + definição)
Inserir em `ia_regras_proibidas` uma regra de **terminologia** explicando "passagem de lente":
- Definição: serviço de remontar lentes existentes do cliente em uma nova armação
- NÃO confundir com transporte/deslocamento/passagem de ônibus
- NÃO pedir receita para esse serviço
- Resposta padrão: confirmar compatibilidade na loja, valor avaliado presencialmente

### 2. Exemplos modelo (few-shot)
Inserir 3 exemplos em `ia_exemplos_modelo` cobrindo:
- **Ex 1**: Cliente diz "quanto custa a passagem da lente?" → IA responde sobre serviço de montagem, **sem pedir receita**
- **Ex 2**: Cliente diz "quero passar minha lente para outra armação" → IA confirma serviço, indica loja, sem receita
- **Ex 3**: Cliente diz "tem passagem?" no contexto de óptica → IA entende como serviço, não como deslocamento

### 3. Regra sobre quando pedir receita
Reforçar regra existente em `ia_regras_proibidas`:
- Receita é solicitada **apenas** para: orçamento de lentes novas, troca por grau diferente, lentes de contato
- Receita **NÃO** é pedida para: passagem de lente, ajuste de armação, conserto, troca de plaqueta/parafuso, limpeza, regulagem

### 4. Atualizar memória do projeto
Criar `mem://ia/glossario-servicos-opticos.md` documentando esses serviços e quando exigir receita, mais entrada no índice.

### Resultado
Próxima conversa, ao detectar "passagem", "passar a lente", "remontar", "trocar de armação" → Gael responde sobre serviço de montagem, indica loja para avaliação, **sem pedir receita** e **sem falar em transporte**.
