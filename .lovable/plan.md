

# Corrigir Roteamento de Contatos Loja no Pipeline

## Problema

Natan Borges (tipo `loja`) está na coluna "Link Enviado" do **Financeiro**, mas deveria estar visível no pipeline de atendimento. Isso acontece porque:

1. O setor **"Atendimento Gael"** (destinado a lojas) não tem nenhuma coluna de pipeline
2. O webhook de WhatsApp roteia lojas para `internalColunas`, que mistura Financeiro + Agendamentos — o primeiro "Novo" encontrado é do Financeiro
3. O ai-triage carrega TODAS as colunas sem filtro de setor — quando sugere uma coluna como "Orçamento", pode pegar a de qualquer setor

## Solução

### 1. Criar colunas de pipeline para o setor "Atendimento Gael"

Migration SQL para criar colunas dedicadas ao atendimento de lojas:

| Coluna | Ordem |
|--------|-------|
| Novo | 0 |
| Em Atendimento | 1 |
| Aguardando Resposta | 2 |
| Resolvido | 3 |

### 2. Corrigir roteamento no webhook (whatsapp-webhook)

No bloco de CRM ROUTING (linhas 193-209), filtrar `internalColunas` pelo setor correto:
- Buscar o setor "Atendimento Gael" pelo nome
- Filtrar colunas internas apenas desse setor para contatos loja/colaborador
- Fallback: se não encontrar, usar o primeiro setor interno disponível

### 3. Corrigir ai-triage para respeitar o setor do contato

Na query de `pipeline_colunas` (linha 882), continuar carregando todas, mas na hora de aplicar a coluna sugerida (linhas 1678-1684), filtrar pelo setor correto:
- Se contato é loja → usar colunas do setor "Atendimento Gael"
- Se contato é cliente → usar colunas de vendas (setor_id IS NULL)
- Isso evita que a IA mova um contato loja para uma coluna do Financeiro

### 4. Corrigir Natan Borges agora

Migration para mover Natan Borges para a coluna "Novo" do setor "Atendimento Gael" recém-criada.

## Arquivos modificados

| Local | Mudança |
|-------|---------|
| Migration SQL | Criar 4 colunas para setor "Atendimento Gael" |
| Migration SQL | Mover Natan Borges para coluna correta |
| `supabase/functions/whatsapp-webhook/index.ts` | Filtrar colunas internas pelo setor "Atendimento Gael" |
| `supabase/functions/ai-triage/index.ts` | Filtrar coluna sugerida pelo setor do contato |

## Resultado

- Contatos tipo `loja` aparecem no pipeline interno correto, não mais no Financeiro
- AI-triage não mistura colunas entre setores
- Natan Borges fica visível no pipeline de atendimento

