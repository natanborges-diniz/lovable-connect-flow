---
name: Campanha OAB — Advogados
description: Advogados inscritos na OAB (Osasco e Região) têm 20% parcelado / 30% à vista. IA só menciona quando cliente se identifica como OAB ou dispara mensagem de abertura da campanha.
type: feature
---

## Condições

- **Público:** Advogados inscritos na OAB
- **Região:** Óticas Diniz Osasco e Região
- **Desconto:** 20% parcelado / 30% à vista

## Gatilhos (únicos casos em que IA pode mencionar)

1. Cliente envia mensagem de abertura vinda do link da campanha:
   > "Olá! Eu sou advogado inscrito na OAB. Gostaria de saber das condições especiais que tenho nas Óticas Diniz de Osasco e Região"
   (link: `https://api.whatsapp.com/send?phone=5511993698211&text=...OAB...`)
2. Cliente se apresenta como advogado / OAB.
3. Cliente pergunta quais vantagens de ser advogado / OAB.

## Regras

- **NUNCA** ofertar proativamente para clientes que não se identificaram como OAB.
- Ao identificar OAB: confirmar condições → seguir fluxo normal (receita → cotação) → aplicar desconto na cotação apresentada.
- IA **não pede** carteira/cédula da OAB. Validação é feita na loja no fechamento.

## Onde vive

- `conhecimento_ia` categoria `campanhas` → "Campanha OAB — Advogados Óticas Diniz Osasco e Região"
- `ia_instrucoes_prompt` categoria `campanhas`
- `ia_regras_proibidas` categoria `campanhas` (bloqueia oferta proativa)
- `ia_exemplos` categoria `campanhas` (resposta ideal ao gatilho de abertura)
