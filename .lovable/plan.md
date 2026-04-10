

# Responsáveis via Telefones Corporativos + Tipos de Input no Editor de Fluxos

## Problema 1: Responsáveis com cadastro duplicado
Hoje, ao adicionar um responsável a um fluxo, o operador precisa digitar nome e telefone manualmente — mesmo que esses dados já existam na tabela `telefones_lojas` (Telefones Corporativos). Isso gera retrabalho e inconsistências.

## Problema 2: Tipos de input invisíveis no editor
Os novos tipos de input (`selecionar_loja_ou_setor` e `imagem`) não aparecem no dropdown do editor de etapas dos fluxos, impedindo que o operador visualize ou edite essas etapas pela interface.

---

## Solução

### 1. FluxoResponsaveisSection — Dropdown de Telefones Corporativos

**Arquivo**: `src/components/configuracoes/FluxoResponsaveisSection.tsx`

- Adicionar query para buscar todos os registros ativos de `telefones_lojas`
- Substituir os campos manuais de Nome e Telefone por um **Select/Combobox** que lista os telefones corporativos agrupados por tipo (Loja / Colaborador / Departamento)
- Ao selecionar, preenche automaticamente `nome` e `telefone` no insert
- O label exibirá: nome_loja (ou nome_colaborador) + telefone
- Manter o campo Tipo (Primário/Contingência) como está

### 2. Novos tipos de input no editor de fluxos

**Arquivo**: `src/components/configuracoes/BotFluxosCard.tsx`

- Adicionar ao array `TIPOS_INPUT`:
  - `{ value: "selecionar_loja_ou_setor", label: "Loja/Setor (lista)" }`
  - `{ value: "imagem", label: "Imagem/Documento" }`
- Isso permitirá que o operador veja e edite etapas com esses tipos no formulário de fluxos

---

## Arquivos Modificados

| Arquivo | Mudança |
|---------|---------|
| `src/components/configuracoes/FluxoResponsaveisSection.tsx` | Dropdown com telefones corporativos em vez de input manual |
| `src/components/configuracoes/BotFluxosCard.tsx` | Dois novos tipos no array `TIPOS_INPUT` |

