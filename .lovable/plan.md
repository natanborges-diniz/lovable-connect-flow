
Usuário esclareceu: Kodak EXISTE na ótica, só não está cadastrada no banco. Ele anexou a tabela oficial Kodak Multifocal Tradicional para eu extrair os valores reais e responder o Leandro com "a partir de [menor valor]".

## Leitura da tabela Kodak (imagem)

**Kodak Precise — Multifocal Tradicional**
Linhas (índice de refração):
- **1.50 + Transitions Gen S + Blue UV** (proteção luz azul + fotossensível)
- **1.50 Poly (policarbonato) Polywave + Blue UV**

Colunas (tratamentos), valores em R$:
| Tratamento | 1.50 Transitions | 1.50 Poly Transitions |
|---|---|---|
| Crizal Prevencia | 2.045 | 2.334 / 3.584* |
| Crizal Sapphire HR | 2.045 | 2.334 |
| Crizal Rock | 2.925 | 1.964 |
| Crizal Easy Pro | 1.209 | 1.498 |
| Optifog | 1.554 | 1.823 |
| No Reflex | 1.014 | 1.303 |
| Trio Easy Clean | 969 | 1.258 |
| Sem AR | 481 | 969 |

(linhas com valor maior em itálico = com Transitions ativado: 3.295 / 3.584)

**Faixa do grau do Leandro (OD +0.75 / OE +0.25 -0.25 ADD +2.00):** dentro do range -9,00 a +6,00 → **cabe em todas as opções**.

**Mais barata com tudo que ele pediu (multifocal + Transitions + AR + antiembaçante):**
- Kodak Precise 1.50 + Transitions Gen S + Blue UV + **Optifog** (antiembaçante Essilor) = **R$ 1.554**
- Alternativa só AR rápido: Trio Easy Clean = **R$ 969** (AR básico, sem antiembaçante)
- Premium AR: Crizal Sapphire HR / Prevencia = R$ 2.045

**Recomendação para "a partir de"**: usar **R$ 969** (entrada multifocal Kodak + Transitions + AR básico) como gancho — segue padrão "a partir de" e deixa upgrade pra loja.

## Plano de execução

### 1. Enviar mensagem manual ao Leandro via WhatsApp
- `send-whatsapp` no provedor Evolution (continuidade do canal)
- Remetente: consultor humano (não "Assistente IA") — não dispara anti-loop
- Conteúdo:
  - Pedido de desculpas pela demora
  - Confirmação: Kodak Precise multifocal, Transitions Gen S (mudança rápida) + Blue UV + AR
  - **"a partir de R$ 969"** (lente, sem armação)
  - Upgrades disponíveis: Optifog (antiembaçante) R$ 1.554 / Crizal Sapphire HR R$ 2.045
  - Armação: a partir de R$ 198 com desconto no combo
  - Convite para Antônio Agú quando vier a Osasco

### 2. Registrar evento no CRM
Inserir em `eventos_crm` `resposta_humana_consultor` com resumo + valores enviados (rastreabilidade).

### 3. NÃO bloquear Kodak no Gael
Reverter qualquer regra que diga "Kodak não existe". Em vez disso:
- Inserir em `ia_regras_proibidas` (categoria `informacao_falsa`): "Trabalhamos com Kodak (Precise multifocal). Catálogo ainda não está no banco — quando cliente pedir Kodak, **escalar para humano** com tag `kodak_orcamento_manual`. NÃO inventar valores."
- Inserir 1 exemplo few-shot: cliente pede Kodak → IA confirma "Trabalhamos sim com Kodak ✅ Vou te conectar com um consultor agora pra passar os valores certinhos da linha Precise" → escala.

### 4. Atualizar memória
Criar `mem://ia/marca-kodak-escalada-manual.md`: "Kodak existe na operação mas fora do `pricing_table_lentes`. Sempre escalar para humano. Nunca prometer valor."
Atualizar `mem://index.md` Core: trocar a regra anterior por "Kodak: real, mas escala manual obrigatória até cadastro completo."

## Resultado
- Leandro recebe resposta honesta hoje, com "a partir de R$ 969" (valor real da sua tabela), pedido de desculpas, e caminho claro para fechar.
- Gael nunca mais nega Kodak nem inventa valor — escala automaticamente para consultor.
- Memória do projeto consistente com a realidade operacional.
