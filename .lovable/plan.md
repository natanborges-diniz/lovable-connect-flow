

# Triagem Inteligente: 3 Grupos de Contato no WhatsApp

## Situação Atual

- A IA trata todos os contatos não-corporativos como clientes potenciais
- Já existem colunas **Compras** e **Parcerias** no pipeline (grupo "outros")
- Já existem intenções `compras` e `parceria` no enum da tool `responder`
- Não existe detecção pré-LLM para rede Diniz, franchising, fornecedores ou B2B
- Setores existentes: Financeiro, Loja, TI — sem setor "Compras"

## Decisão de Arquitetura

**Abordagem simples**: a IA detecta que o contato NÃO é cliente → escalona imediatamente para o operador humano com contexto claro sobre o tipo de contato. O operador decide o destino manualmente. Sem criar novos setores por enquanto.

As colunas **Compras** e **Parcerias** já existem no pipeline e serão usadas pelo operador para posicionar os cards após a triagem.

## Mudanças

### 1. Detecção pré-LLM (roteador determinístico)

Adicionar regex no `ai-triage` para detectar padrões antes do LLM processar:

**Rede Diniz / Franchising:**
- "sou da Diniz", "Diniz de [cidade]", "outra unidade", "franqueado", "franchising", "lojista Diniz", "sou gerente da", "sou da loja"

**Fornecedores / B2B:**
- "representante comercial", "ofereço/oferta de", "fornecedor", "proposta comercial", "parceria", "distribuidor", "vendo [produto] para", "tabela de preços"

Quando detectado: escalona para humano com mensagem educada e motivo específico (ex: `contato_rede_diniz`, `fornecedor_b2b`, `proposta_parceria`). Move o card para a coluna **Parcerias** ou **Compras** conforme o caso.

### 2. Instruções no system prompt do LLM

Adicionar bloco no prompt para os casos que o regex não pegar:

```text
# CONTATOS NÃO-CLIENTE
Se a pessoa se identificar como:
- De outra unidade Diniz, franqueado, ou Diniz Franchising
- Fornecedor, representante comercial, distribuidor
- Alguém oferecendo produtos/serviços (B2B)
- Alguém buscando parceria

→ NÃO trate como cliente. NÃO ofereça produtos, preços ou agendamentos.
→ Use escalar_consultor com motivo específico.
→ Responda: "Entendido! Vou direcionar para o responsável da nossa equipe."
```

### 3. Contexto no escalonamento

Quando o operador recebe o card na fila humana, o metadata do atendimento incluirá:
- `motivo_escalonamento`: tipo específico (rede_diniz, fornecedor, parceria)
- Isso aparece visualmente para o operador saber que **não é cliente**

### 4. Contato marcado como tipo adequado

Quando a IA detecta fornecedor/B2B, atualiza o `contato.tipo` para `fornecedor` (já existe no enum). Para rede Diniz, usa tag `rede_diniz`.

## Arquivos Modificados

| Arquivo | Mudança |
|---------|---------|
| `supabase/functions/ai-triage/index.ts` | Regex pré-LLM para rede Diniz e B2B + bloco no system prompt + atualizar tipo do contato quando detectado |

## O que NÃO muda

- Nenhum setor novo criado (operador roteia manualmente)
- Nenhuma migração de banco necessária
- O fluxo de lojas (bot-lojas) continua inalterado
- O fluxo de clientes continua inalterado

