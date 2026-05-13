
## Diagnóstico

No `ai-triage/index.ts` (~linha 2424), o **fast-path determinístico de saudação** dispara sempre que `inboundCount === 1 OU (precisaConfirmarNome && !nomeConfirmado)`.

Quando o contato entra com `metadata.precisa_confirmar_nome = true` (caso da Beatriz, cujo nome no WhatsApp era "."), a condição `precisaConfirmarNome` permanece `true` a cada novo inbound. O fast-path **retorna antes do LLM**, então `registrar_nome_cliente` nunca é chamada — mesmo quando o cliente responde "Beatriz", "Me chamo Beatriz", "Bia", etc. Resultado: a IA repete "Antes de seguir, posso saber seu nome, por favor? 😊" indefinidamente.

Logs confirmam: `[FAST-PATH] greeting_deterministic_sent` dispara em cada turno e o fluxo nunca chega à tool.

## Correção

Quando o fast-path detecta que o **último inbound do cliente parece conter um nome** (texto curto com letras, sem ser pergunta/saudação genérica), ele deve:

1. **Persistir o nome direto via SQL** (mesmo update que `registrar_nome_cliente` faz: `contatos.nome = X`, `metadata.nome_confirmado=true`, `precisa_confirmar_nome=false`, `nome_origem='ia_fast_path'`).
2. **Não enviar "Antes de seguir..." de novo** — em vez disso, sair do fast-path e **deixar o LLM seguir** o atendimento normal (cliente já respondeu o que precisava; próximo passo é responder à intenção real, que no caso é "Acessei o site... gostaria de mais informações").

### Heurística "parece nome" (determinística, sem LLM)

Aplica quando `precisaConfirmarNome && inboundCount > 1` e o último inbound:
- Tem entre 2 e 40 caracteres após trim
- Contém ≥1 token de letras com 2+ chars (`/[A-Za-zÀ-ÿ]{2,}/`)
- Não termina com `?`
- Após remover prefixos comuns ("me chamo ", "meu nome é ", "sou a ", "sou o ", "é "), o que sobra é só nome (sem dígitos longos, sem URLs, sem `@`)
- Não é saudação pura ("oi", "olá", "bom dia", "tudo bem", etc.)

Extrai o primeiro token capitalizado como nome (ou usa o texto limpo inteiro se ≤2 palavras).

### Fluxo após persistir

- Chama `logEvent(..., "nome_registrado_fast_path", nome)`.
- **Não retorna** — segue o restante do `ai-triage` para que o LLM responda à intenção real do cliente já tratando-o pelo nome.
- Recarrega `contatoNomeAtual = nome` em memória para o prompt.

### Salvaguarda extra

Se a heurística NÃO reconhecer o texto como nome após 3 turnos consecutivos pedindo nome, **escala para humano** com motivo "loop_pedido_nome" em vez de seguir repetindo a mesma frase.

## Arquivos afetados

- `supabase/functions/ai-triage/index.ts` (~linha 2424–2458): refatora o bloco fast-path conforme acima.
- `.lovable/memory/ia/saudacao-confirma-nome.md`: atualiza descrevendo a auto-persistência + escalada anti-loop.

## Validação

- Curl em `ai-triage` simulando o atendimento da Beatriz (3 inbounds: ".", "Beatriz", "Me chamo Beatriz") — esperado: 1ª pede nome, 2ª persiste "Beatriz" + responde sobre o site, 3ª e seguintes não repetem a pergunta.
- Verificar `contatos.nome` atualizado e `metadata.precisa_confirmar_nome=false` no banco após o teste.
