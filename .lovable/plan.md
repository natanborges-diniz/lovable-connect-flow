## Objetivo
Fechar o Fluxo B (Setor → Loja/Grupo) no Atrium, dando ao operador a UI para disparar uma demanda e melhorando o thread em modo grupo para se parecer com um grupo de WhatsApp (todas as lojas vendo todos falarem).

## 1) `AcionarLojaDialog` (novo)
Arquivo: `src/components/atendimentos/AcionarLojaDialog.tsx`

Diálogo único com dois modos:

**Modo "Loja única"** (default)
- Combobox com lojas (`telefones_lojas` onde `tipo='loja'` e `ativo=true`, distinct por `nome_loja`).
- Campo Assunto (curto) e Mensagem inicial (textarea).
- (Opcional v1) anexo: deixar como TODO — não bloqueia o uso.

**Modo "Grupo de lojas"**
- Toggle "Acionar várias lojas".
- Checklist de lojas (mesma fonte). Atalhos: "Selecionar todas", "Limpar".
- Mesmo Assunto + Mensagem inicial.

**Ação:** chama `supabase.functions.invoke("criar-demanda-loja", { body })`:
- Loja única: `{ atendimento_id, loja_nome, loja_telefone, assunto, pergunta }`
- Grupo: `{ atendimento_id, lojas: [{nome_loja, telefone}, ...], assunto, pergunta }`

Em sucesso: toast com protocolo, fecha diálogo e dispara callback `onCreated(demanda_id)`.

**Importante:** o diálogo precisa de um `atendimento_id` (a EF exige modo `humano`). Por isso o botão "Acionar loja(s)" abrirá:
- A partir de **`AtendimentoView`** (chat humano aberto): usa o `atendimento.id` corrente.
- A partir de **`/demandas`** (lista geral): se não há atendimento de cliente em foco, o botão fica **desabilitado** com tooltip "Abra um atendimento humano para acionar lojas". *(Esta é a regra atual da EF — manter consistente.)*

## 2) Botão "Acionar loja(s)" no `AtendimentoView`
- Adicionar no header de ações do atendimento (perto de outras ações tipo "Encerrar"), visível só quando `modo === "humano"`.
- Abre `AcionarLojaDialog` passando `atendimento_id`.
- Em sucesso, navega para `/demandas?demanda=<id>` (ou abre o painel inline existente).

## 3) Thread em modo grupo — header rico + autor por loja
Arquivo: `src/components/atendimentos/DemandaThreadView.tsx`

**Header (quando `metadata.grupo === true`):**
- Badge "Grupo" + ícone `Users`.
- Título `#NN • Grupo (N lojas)`.
- Lista expansível de lojas participantes (`metadata.lojas_nomes`) — colapsada por padrão, expande ao clicar em "ver lojas". Já temos linha resumo; transformar em colapsável com `<details>`/popover leve.

**Identificação por loja em mensagens inbound (`loja_para_operador`):**
- Hoje mostramos só `autor_nome` (nome do usuário Messenger).
- Em modo grupo, prefixar com **nome da loja** quando disponível em `mensagens_internas.metadata.loja_nome` (snapshot gravado pela EF de ingresso de resposta).
- Render: `[NomeLoja] · NomeUsuário` em destaque (estilo cabeçalho de mensagem em grupo de WhatsApp).
- Cor de avatar/badge derivada deterministicamente do `loja_nome` (hash → tom HSL fixo) para diferenciar visualmente.

**Pequena dependência na EF de entrada (`receber-mensagem-interna-loja` ou equivalente que insere em `demanda_mensagens`):** garantir que ao gravar a resposta da loja em `demanda_mensagens`, o campo `metadata.loja_nome` seja preenchido a partir de `user_roles.loja_nome` do remetente. Se essa EF já existe, ajustar; se não, é trivial — leitura de `user_roles` pelo `remetente_id` antes do insert.

## 4) Detalhes técnicos
- Lojas para o combobox/checklist: `select distinct nome_loja, telefone from telefones_lojas where tipo='loja' and ativo=true order by nome_loja`. Hook `useLojas()` em `src/hooks/useLojas.ts`.
- Validação Zod no diálogo (assunto 1–120, mensagem 1–2000, lojas ≥1 em modo grupo).
- A EF `criar-demanda-loja` já suporta os dois modos — sem mudança backend.
- Realtime no thread já está OK (`useDemandaMensagens`).

## 5) Fora de escopo (próximo turno)
- Anexos no `AcionarLojaDialog` (upload p/ `whatsapp-media` + `metadata.anexo_url` na primeira mensagem).
- Fluxo A (`criar-solicitacao-loja`) já entregue; UI consumidora vive no Messenger.

## Arquivos
- Criar: `src/components/atendimentos/AcionarLojaDialog.tsx`, `src/hooks/useLojas.ts`
- Editar: `src/components/atendimentos/DemandaThreadView.tsx` (header colapsável + autor por loja), `src/pages/Atendimentos.tsx` (botão no header), possivelmente `src/pages/Demandas.tsx` (botão desabilitado com tooltip)
- Possivelmente editar a EF que recebe respostas da loja para gravar `metadata.loja_nome` em `demanda_mensagens` (verificar antes de alterar).
