## Triagem de Consulta de OS — escalada direta para humano

Objetivo: quando o cliente pergunta sobre **status do pedido** ("óculos pronto?", "posso retirar?", "cadê meu óculos?", "número da OS"), a IA **NÃO pode pedir receita** nem oferecer orçamento. Deve reconhecer o intent e **encaminhar imediatamente para um atendente humano**, com contexto.

### 1. Detector de intent `consulta_os` (em `ai-triage`)

Antes do LLM rodar, um detector determinístico por regex/keywords classifica a mensagem como `consulta_os` quando aparecem sinais como:

- "óculos pronto", "ficou pronto", "está pronto", "tá pronto"
- "posso retirar", "já chegou", "chegou meu", "quando fica pronto", "quando chega"
- "cadê meu pedido", "onde está meu pedido", "status do pedido"
- "minha OS", "ordem de serviço", "número da OS", "OS 12345"

Lista editável em `configuracoes_ia` (chave `os_intent_keywords`) — auditoria pode tunar sem redeploy.

### 2. Bloqueios obrigatórios quando `consulta_os = true`

Aplicados **antes** de chamar o LLM (hard guards, não confiam no modelo):

- **Proíbe** as tools `interpretar_receita`, `consultar_lentes_estimativa`, `consultar_lentes_contato` e `agendar_visita`
- **Bloqueia** qualquer texto que peça receita, foto, grau, ADD, CIL, esférico
- **Bloqueia** orçamento — não pode citar preço, faixa, marca de lente
- Anti-loop: se a IA já pediu receita 1x antes e a próxima mensagem do cliente bater nesse intent, força a escalada imediatamente

### 3. Resposta padrão e escalada

A IA responde **uma única mensagem fixa** (editável em `ia_mensagens_fixas`, chave `os_escalada`):

> "Claro! Para consultar o status do seu pedido vou te passar para um atendente da loja agora. Pode me confirmar **seu nome completo** e, se tiver em mãos, o **número da OS** (vem no comprovante de compra). Já estou chamando alguém pra te atender."

Em seguida, **automaticamente**:
- Atendimento muda para `modo='humano'`
- Card vai para coluna **"Consulta de OS"** (nova) no pipeline correspondente
- Disparo de push/notificação aos usuários da loja vinculada ao contato (ou setor Atendimento Corporativo se não houver loja)
- `eventos_crm` registra `tipo='consulta_os'` com a mensagem original do cliente

Fora do horário humano (Seg-Sex 09-18 / Sáb 08-12 SP), copy adicional informa quando a loja retorna — usa o mesmo padrão já existente do horário comercial humano.

### 4. Roteamento no CRM

- **Coluna nova "Consulta de OS"** criada via migração, no setor **Atendimento Corporativo** (ou no setor Lojas, conforme decisão) — ordem após "Pós-Venda"
- Card é movido para essa coluna no momento da escalada, com `metadata.intent='consulta_os'` e a frase original do cliente
- Operador da loja resolve usando seu próprio sistema (ERP) e responde pelo Atrium normalmente

### 5. Treinamento defensivo (memória de longo prazo)

- 3 exemplos novos em `ia_exemplos` categoria `consulta_os` ensinando: cliente pergunta status → IA escala, NÃO pede receita
- 1 regra em `ia_regras_proibidas` categoria `comportamento`: "Quando cliente pergunta sobre status do pedido/OS/óculos pronto, JAMAIS peça receita, foto ou ofereça orçamento. Sempre escale para humano."
- Compilador de prompt (`compile-prompt`) já injeta automaticamente essas duas fontes — basta inserir as linhas via migração

### 6. Por que essa abordagem (sem integrar com ERP agora)

- Resolve **imediatamente** o problema relatado (IA confundindo consulta com orçamento e pedindo receita)
- Zero dependência externa — não precisa do endpoint do Infoco OB nem do Firebird Bridge funcionando
- Operacionalmente seguro: humano tem acesso ao ERP, IA não inventa prazo nem etapa
- Se no futuro quiser automatizar a resposta consultando o ERP, dá pra plugar uma tool `consultar_status_os` sem desfazer nada

---

### Resumo técnico

**Arquivos editados:**
- `supabase/functions/ai-triage/index.ts` — detector `consulta_os`, hard guards (bloquear tools de receita/orçamento), escalada automática
- `supabase/functions/compile-prompt/index.ts` — sem mudança (já consome `ia_exemplos` + `ia_regras_proibidas`)

**Migração SQL:**
- Inserir 1 linha em `pipeline_colunas` ("Consulta de OS") no setor Atendimento Corporativo
- Inserir chave `os_intent_keywords` em `configuracoes_ia` (lista JSON de regex/keywords)
- Inserir chave `os_escalada` em `ia_mensagens_fixas` (mensagem padrão)
- Inserir 3 linhas em `ia_exemplos` (categoria `consulta_os`)
- Inserir 1 linha em `ia_regras_proibidas` (proibir pedir receita em consulta_os)

**Sem secrets novos.** **Sem dependência cross-project.**

**Validação:**
- Simular 5 frases de teste no `ai-triage` ("meu óculos tá pronto?", "qual número OS minha?", "quando posso retirar?", etc.) e conferir que escalou para humano e não pediu receita
- Conferir card aparece na coluna "Consulta de OS" e push chegou aos usuários da loja