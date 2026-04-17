

## Saneamento corporativo — cobertura atual e futura

### Resposta direta
Sim — o plano cobre o caso atual (Natan) **e** previne para qualquer número futuro. Mas preciso ajustar 2 pontos do plano original para ficar 100%.

### O que o webhook já faz (linha 121-150)
- Detecta `lojaMatch` em `telefones_lojas` toda mensagem inbound.
- Atualiza `contato.tipo` para `loja`/`colaborador` se diferente.
- Preserva nome da marca/loja.

### O que falta (gap que pegou o Natan)
O webhook **não trata** contatos pré-existentes que:
1. Têm `pipeline_coluna_id` apontando pro CRM Vendas (legado de quando eram "cliente").
2. Têm atendimento aberto em `modo='humano'` órfão (escalonado antes do cadastro corporativo).
3. Não têm `setor_destino` apontando pro setor corporativo.

### Plano ajustado (cobre presente e futuro)

**1. Saneamento one-shot via SQL (resolve todos os corporativos hoje)**
Não só o Natan — varre TODOS os contatos cujo telefone está em `telefones_lojas` ativo e:
- Limpa `pipeline_coluna_id` se aponta para coluna do setor CRM Vendas.
- Define `setor_destino` para o setor "Atendimento Corporativo" (Interno).
- Garante `tipo` = `loja` ou `colaborador`.
- Encerra atendimentos abertos em `modo='humano'` SEM atendente humano atribuído (são órfãos do bot-lojas).
- Loga em `eventos_crm` como `saneamento_corporativo_lote`.

**2. Saneamento contínuo no webhook (cobre números futuros)**
Estende o bloco `if (isCorporate)` (linha 139-150) para, além de atualizar `tipo`/`nome`:
- Se `contato.pipeline_coluna_id` pertence a coluna de setor CRM Vendas → setar `pipeline_coluna_id = null`.
- Se `contato.setor_destino` está vazio ou aponta pra setor não-corporativo → setar para setor corporativo (id buscado uma vez via cache em memória ou query rápida).
- Se há atendimento aberto em `modo='humano'` SEM `atendente_nome` (= órfão, ninguém pegou) → reverter para `modo='ia'` ou encerrar (decisão: encerrar, pois `bot-lojas` cria sessão própria).
- Logar evento `reclassificacao_corporativa`.

Resultado: **qualquer número** que entrar em `telefones_lojas` (agora ou no futuro) será saneado automaticamente na próxima mensagem que enviar.

**3. Trigger opcional (defesa em profundidade)**
Adicionar trigger `AFTER INSERT OR UPDATE ON telefones_lojas` que:
- Quando um número é cadastrado/ativado, busca contato existente por telefone e roda o mesmo saneamento (limpa CRM, ajusta tipo/setor, encerra humano órfão).
- Garante saneamento **imediato** ao cadastrar, sem precisar esperar nova mensagem.

**4. Filtro visual da Fila Humana (já estava no plano)**
Em `useAtendimentos`/`Pipeline.tsx`, excluir da fila humana cards onde `contato.tipo` ∈ {`loja`, `colaborador`, `fornecedor`}. Defesa de UI.

### Arquivos a alterar

| Arquivo | Mudança |
|---|---|
| Migration `<ts>_saneamento_corporativo.sql` | (a) saneamento one-shot em todos os corporativos hoje; (b) trigger `on_telefone_loja_change` chamando função `sanitize_corporate_contact(telefone)` |
| `supabase/functions/whatsapp-webhook/index.ts` (linha 139-150) | Estender bloco `isCorporate`: limpar `pipeline_coluna_id` se for de setor Vendas, setar `setor_destino` corporativo, encerrar atendimento humano órfão |
| `src/hooks/useAtendimentos.ts` (a confirmar) | Filtrar fila humana por `contato.tipo === 'cliente'` |
| `mem://crm/fila-prioridade-humana.md` | Documentar exclusão de corporativos + saneamento automático |

### Pendência mínima de descoberta
- Confirmar UUID do setor "Atendimento Corporativo" (Interno) e do setor CRM Vendas (consulta em `setores`/`pipeline_colunas`).
- Confirmar arquivo exato que monta a fila humana (provável `useAtendimentos.ts`).

Posso prosseguir com essa versão ajustada?

