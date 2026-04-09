

# Seleção de Loja para Link de Pagamento — Departamentos e Colaboradores

## Problema

Quando um **departamento** ou **colaborador** solicita um link de pagamento, o bot não sabe qual `cod_empresa` usar na API, pois o número não pertence a uma loja. O sistema precisa apresentar a lista de lojas cadastradas para o solicitante escolher antes de prosseguir com o fluxo.

## Solução

Inserir uma etapa intermediária automática no motor do bot (`bot-lojas/index.ts`). Quando o fluxo selecionado for `link_pagamento` (ou qualquer fluxo com `acao_final.endpoint === "payment-links"`) e o `tipoBot` for `departamento` ou `colaborador`, o bot:

1. Consulta `telefones_lojas` filtrando `tipo = 'loja'` e `ativo = true`
2. Apresenta lista numerada das lojas disponíveis
3. Aguarda seleção do usuário (etapa `selecionar_loja`)
4. Armazena `cod_empresa` e `nome_loja` da loja escolhida nos `dados` da sessão
5. Prossegue normalmente com `step_0` do fluxo de link de pagamento

## Alteração Técnica

**Arquivo único**: `supabase/functions/bot-lojas/index.ts`

### Mudanças no fluxo:

1. **Após selecionar opção de menu** (bloco `fluxo === "menu_principal"`): quando o fluxo carregado tem `acao_final.endpoint === "payment-links"` e `tipoBot !== "loja"`, em vez de ir para `step_0`, vai para etapa `selecionar_loja` com a lista de lojas.

2. **Nova etapa `selecionar_loja`**: handler que valida a escolha numérica, resolve a loja e sobrescreve `nomeLoja`/`codEmpresa` nos dados da sessão, depois avança para `step_0`.

3. **Em `executarAcaoFinal`**: usar `dados.loja_selecionada_cod` e `dados.loja_selecionada_nome` (se presentes) como override do `nomeLoja`/`codEmpresa` passados pela sessão original.

```text
Departamento/Colaborador seleciona "Link de Pagamento"
    │
    ├── tipoBot == "loja" → step_0 (fluxo normal, cod_empresa já existe)
    │
    └── tipoBot != "loja" → etapa "selecionar_loja"
         │
         │  "Selecione a unidade para gerar o link:"
         │   1️⃣ Ótica Centro (001)
         │   2️⃣ Ótica Shopping (002)
         │
         └── Usuário digita número → armazena cod_empresa → step_0
```

### Confirmação

Na tela de confirmação (`buildConfirmacao`), o campo `loja` aparecerá mostrando qual unidade foi selecionada.

## Resultado

- Departamentos e colaboradores podem gerar links de pagamento vinculados a qualquer loja
- Lojas continuam com fluxo inalterado (sem etapa extra)
- O `cod_empresa` correto é enviado à API de pagamento

