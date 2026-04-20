

## Objetivo
Substituir todas as menções a "Equipe Atrium" / "Atrium" no conteúdo voltado ao cliente final (mensagens WhatsApp, templates, prompts da IA, assinaturas) por **"Óticas Diniz"**. Atrium continua sendo o nome interno do app de mensageria (uso B2B), mas o cliente final nunca deve ver essa marca.

## Escopo da correção

### 1. Templates WhatsApp (banco)
Migration UPDATE em `public.whatsapp_templates` corrigindo qualquer ocorrência de "Atrium" no campo `body`. Casos identificados na última migration:
- `despedida_cordial`: "Equipe Óticas Diniz" já está correto ✅
- Demais templates: varrer e garantir que nenhum cite "Atrium".
- Resetar `status = 'rascunho'` apenas nos templates efetivamente alterados (preserva os já aprovados).

### 2. Prompts da IA (banco)
Tabela `prompt_compilado` / `regras_aprendizado` / `exemplos_modelo` /