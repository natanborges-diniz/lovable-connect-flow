---
name: Comparação e Detalhamento de Lentes — Conhecimento de Marca
description: Conhecimento técnico/comercial de cada marca/família de lentes do catálogo. Usado quando cliente pede "detalhar", "diferença", "comparar" lentes já cotadas. Injetado no prompt como bloco [FLUXO DETALHAMENTO/COMPARAÇÃO DE LENTES].
type: feature
---

## Quando usar

Após enviar orçamento (`consultar_lentes` formato com 💚 Econômica / 💛 Intermediária / 💎 Premium), se o cliente pedir:
- "detalhe", "detalhar", "me explica"
- "diferença entre", "comparar", "compare"
- "qual a melhor", "por que [marca]", "vantagem da"

A IA deve responder com **1 parágrafo curto por marca solicitada (3–4 linhas)** destacando 2–3 diferenciais técnicos/comerciais. Fechar com **uma única pergunta** entre escolher uma das opções OU agendar visita.

**Proibido nesse contexto:**
- "Quer que eu detalhe?" (já está sendo pedido)
- "Já mandei as opções acima"
- "Me conta mais", "conta pra mim com mais detalhes" (são para casos sem contexto)
- Fallbacks genéricos do `VALIDATOR_FAILED_POOL`

## Conhecimento por marca

### DNZ (linha própria Diniz)
- **Posicionamento:** entrada / custo-benefício, fabricação nacional.
- **DNZ HDI / DNZ Mensal / DNZ 1 Day:** boa relação preço × qualidade óptica.
- **AR Verde / AR Azul:** antirreflexo padrão, reduz ofuscamento e melhora estética.
- **Indicação:** quem busca preço acessível sem abrir mão de qualidade visual básica.
- **Diferencial comercial:** marca da casa, melhor margem para promoções e combos.

### Essilor
- **Posicionamento:** premium global, líder mundial em lentes oftálmicas.
- **Famílias relevantes:**
  - **Eyezen / Eyezen Boost:** desenhada para fadiga visual digital (celular/computador). Áreas de relaxamento acomodativo no inferior da lente.
  - **Varilux:** referência em multifocais (presbiopia).
  - **Stylis:** alto índice (1.67 / 1.74) para receitas altas, lentes finas e leves.
- **Tratamentos:**
  - **Crizal Sapphire HR:** antirreflexo de alta performance (transparência máxima).
  - **Crizal Prevencia:** filtro de luz azul nociva + antirreflexo + UV.
  - **Crizal Forte UV / Easy Pro:** linhas mais simples.
- **Indicação:** quem usa muita tela, profissional liberal, quer durabilidade premium.

### Zeiss
- **Posicionamento:** alemã, engenharia óptica de precisão, referência em design sob medida.
- **Famílias relevantes:**
  - **SmartLife / SmartLife Individual:** desenhada para o estilo de vida conectado (transições rápidas entre celular, tela e mundo real). "Individual" é personalizada ao rosto/armação do cliente.
  - **Single Vision (Visão Simples):** linha de uso geral.
  - **Progressive Individual / Precision:** multifocais sob medida.
- **Tratamentos:**
  - **DuraVision Platinum UV:** antirreflexo top de linha, alta resistência a riscos, proteção UV total.
  - **BlueGuard:** filtro de luz azul **integrado ao material** da lente (não é só uma camada — toda a lente protege).
  - **PhotoFusion:** fotossensível de transição rápida.
- **Indicação:** quem prioriza visão periférica perfeita, conforto em diferentes distâncias, proteção UV/azul máxima e está disposto a investir em tecnologia alemã.

### Hoya
- **Posicionamento:** japonesa, premium, foco em precisão óptica e tratamentos.
- **Diferenciais:** Hi-Vision LongLife (antirreflexo durável), iD MyStyle (multifocais personalizadas).
- **Indicação:** alternativa à Essilor/Zeiss para quem quer marca japonesa de alta qualidade.

### Kodak
- **Posicionamento:** marca licenciada, intermediário-premium acessível.
- **Diferenciais:** boa relação custo × tecnologia, tratamentos CleAR.
- **Indicação:** quem quer marca reconhecida sem o preço Essilor/Zeiss.

### Solflex (Lentes de Contato)
- **Posicionamento:** linha nacional, boa para tóricas (astigmatismo).
- **Solflex Toric:** disponível para receitas com cilíndrico, sob encomenda.

## Resumo: como diferenciar Essilor vs Zeiss (caso mais comum)

| | **Essilor** | **Zeiss** |
|---|---|---|
| Origem | França | Alemanha |
| Foco | Conforto digital, multifocais Varilux | Visão periférica, design sob medida |
| Filtro azul | Crizal Prevencia (camada) | BlueGuard (integrado ao material) |
| Antirreflexo | Crizal Sapphire HR / Prevencia | DuraVision Platinum UV |
| Personalização | Padrão por linha (Eyezen, Varilux) | "Individual" customiza ao rosto/armação |
| Quando indicar | Muito uso de tela, presbiopia (Varilux) | Quem quer máxima precisão e proteção integrada |

## Formato esperado da resposta

Exemplo (cliente pediu detalhe Essilor + Zeiss):

> A **Essilor Eyezen Boost** é da francesa Essilor, líder global. Foi desenhada pra quem usa muito celular/computador — tem zonas de relaxamento que reduzem fadiga visual. Vem com Crizal Prevencia: antirreflexo + filtro de luz azul + proteção UV.
>
> A **Zeiss SmartLife Individual 3** é alemã, top de linha. Ela é *personalizada* ao seu rosto e armação, garantindo visão periférica perfeita. Tem DuraVision Platinum UV (antirreflexo super resistente) + BlueGuard, que é filtro azul **integrado no material** da lente — proteção em toda a superfície, não só na camada.
>
> Resumo: Essilor é referência global em conforto digital; Zeiss entrega precisão alemã sob medida. Quer fechar com uma delas, ou prefere agendar uma visita pra experimentar com armação?
