## Objetivo
Resolver 3 falhas evidenciadas na conversa da Cileia:

1. A IA ignorou completamente o CEP enviado (04381-001) e a "Zona Sul", repetindo "em qual região você está?" duas vezes.
2. A IA enviou uma mensagem genérica fora de contexto ("Sobre o que a gente estava falando…") logo depois de ter mandado o orçamento.
3. Quando o cliente perguntou "qual prazo de confecção?", a IA tratou como consulta de pedido pronto e pediu CPF/OS, em vez de responder o prazo padrão de confecção de lentes.

## Diagnóstico

### 1. CEP/Zona Sul ignorados
- O cliente respondeu "Zona Sul" + CEP "04381-001" logo após a IA pedir a região.
- O fluxo atual só pergunta região, mas **não há nenhum trecho que processe CEP nem região para casar com `telefones_lojas`** e indicar a loja mais próxima.
- Como Osasco/região não cobre a Zona Sul de SP, o caso deveria entrar na "escada de persuasão" definida em `mem://ia/diretrizes-triagem-e-persuasao-local` (`ai-triage/index.ts` linhas 969–974). Mas o sinal nunca chega ao prompt como "cliente fora de área", então o LLM segue ignorando.

### 2. Mensagem fora de contexto
- A frase "Sobre o que a gente estava falando — quer que eu retome o orçamento ou te ajudo com outra coisa?" vem do `genericPool` em `ai-triage/index.ts` linhas 572–593.
- Esse pool é usado como fallback genérico, mas no caso da Cileia foi disparado **logo após o orçamento ter sido enviado**, criando a sensação de "amnésia". O fallback não está checando se acabamos de mandar uma resposta substantiva (orçamento) antes de soltar o genérico.

### 3. "Prazo de confecção" tratado como "status de pedido"
- O regex em `ai-triage/index.ts` linha 545 captura "entrega" e dispara: *"Me passa seu nome completo ou o número da OS que eu consulto aqui rapidinho."*
- Esse regex não distingue entre:
  - Cliente pedindo **prazo de confecção** de uma compra nova (resposta correta: prazo padrão "depende da fabricante, normalmente 7–15 dias úteis após o pagamento", conforme `mem://ia/regras-de-terminologia-e-produto` e linha 1021 do prompt).
  - Cliente pedindo **status de OS já existente** (aí sim: pedir nome/CPF/OS).
- No contexto dela ela acabou de receber orçamento e nunca mencionou pedido pronto — deveria cair no primeiro caso.

## Plano de correção

### A. Detectar e usar região/CEP
1. No `ai-triage`, ao detectar **CEP** (regex `\d{5}-?\d{3}`) ou termos de região da Grande SP ("Zona Sul/Norte/Leste/Oeste", "São Paulo", "SP capital", bairros conhecidos fora de Osasco) na mensagem inbound, montar um sinal `clienteForaDeArea = true` e injetar no prompt um bloco do tipo:
   > [SISTEMA] Cliente sinalizou localização **fora de Osasco e região** (CEP/região: X). Aplique a ESCADA DE PERSUASÃO (1ª insistência: convidar carinhosamente para loja em Osasco; 2ª: reforçar acesso fácil; 3ª: enviar Maps + classificar Perdidos). NUNCA repita "em qual região você está?" — você JÁ sabe.
2. Para regiões/CEPs **dentro** da área (Osasco, Carapicuíba, Barueri, Cotia, Itapevi, Jandira, Santana de Parnaíba, Alphaville), injetar no prompt o trecho com endereço/horário/Maps das `telefones_lojas` mais próximas e instruir: "indique a loja mais próxima — não pergunte região de novo."

### B. Bloquear o fallback genérico após resposta substantiva
- No bloco `genericPool` (linhas 572–593), antes de selecionar uma frase do pool, checar se a **última mensagem outbound** já é uma resposta substantiva recente (< 90s) — orçamento, opções, escalonamento confirmado etc. Se sim, **não emitir** nada do pool e apenas seguir o pipeline normal (deixar o LLM ou o validador decidir; ou silenciar).
- Adicionalmente: remover/refrasar a opção "Sobre o que a gente estava falando — quer que eu retome o orçamento…" do pool, porque ela transmite amnésia mesmo quando aplicável.

### C. Separar "prazo de confecção" de "status de pedido"
- Refinar o regex/classificador em `triage` (linha 545):
  - **Prazo de confecção / fabricação** → palavras-chave: `prazo de (entrega|confecção|fabricação|produção)`, `quanto tempo (demora|leva)`, `quando fica pronto` **sem** menção a "minha OS / meu pedido / já comprei". Resposta padrão:
    > "O prazo de confecção das lentes depende da fabricante e do tipo de tratamento — normalmente entre **7 e 15 dias úteis** após a confirmação do pagamento. Tóricas e lentes especiais podem levar um pouco mais. Quer que eu te direcione pra loja mais próxima pra fechar?"
  - **Status de pedido existente** → palavras-chave: `minha OS|meu pedido|já comprei|comprei dia|fiz o pedido|tá pronto?|já chegou` → pedir nome/CPF/OS (mantém o atual).
- O caso da Cileia ("qual prazo de confecção?") cairia agora no primeiro ramo, sem pedir CPF.

### D. Observabilidade mínima
Logar:
- `[REGION] cep=X regiao=Y foraDeArea=true|false` quando detectado.
- `[FALLBACK-GENERIC] suprimido por resposta substantiva recente`.
- `[PRAZO] tipo=confeccao|status` na classificação.

## Resultado esperado para o cenário da Cileia

```text
Cileia: "estou na Zona Sul" + CEP 04381-001
→ sistema detecta CEP fora de Osasco
→ IA aplica escada de persuasão (1ª investida): "Leia, nossa rede fica em Osasco e região. Atendemos clientes da Zona Sul que vêm aqui pelas nossas condições — quer que eu te conte os diferenciais e como chegar?"
→ NÃO repete "qual sua região?"

Cileia: "qual prazo de confecção?"
→ classificador detecta prazo de fabricação (sem menção a OS existente)
→ IA responde: "O prazo de confecção depende da fabricante, normalmente 7 a 15 dias úteis após o pagamento. Quer fechar pra eu te direcionar à loja?"
→ NÃO pede CPF/OS
```

## Arquivos a editar
- `supabase/functions/ai-triage/index.ts` — pontos A, B, C, D (regex de prazo, detecção de CEP/região, supressão do fallback genérico, injeção de contexto de fora-de-área no prompt).

## Memória a criar (após implementação)
- `mem://ia/prazo-confeccao-vs-status-pedido` — distinção entre "prazo de confecção" (padrão 7–15 dias úteis) e "status de OS" (pede CPF/OS).
- `mem://ia/cep-e-regiao-fora-de-area` — detecção de CEP/região da Grande SP e disparo automático da escada de persuasão sem repetir a pergunta.

Se aprovar, implemento as 4 correções e crio as duas memórias.