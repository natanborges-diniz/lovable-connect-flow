---
name: Correção de Receita por Texto
description: Detects when client types corrected prescription values (OD/OE, longe/perto, esf/cil/eixo/add), replaces saved receita and forces consultar_lentes
type: feature
---

# Correção de Receita por Texto (ai-triage)

## Problema
OCR pode errar valores. Quando o cliente corrige por texto (ex: "OD 0.00 com -2,25 / PERTO: -0,25 com -2,00 eixo 180"), a IA antes confiava cegamente no `metadata.receitas` salvo e respondia genérico ("pode elaborar?"), ignorando a correção.

## Solução
Função `detectPrescriptionCorrection(text)` roda **antes** do loop detector. Critérios:
- ≥2 marcadores clínicos (OD/OE/OS, longe/perto, esf/cil, eixo, add/adição)
- ≥2 valores numéricos
- Pelo menos um olho com `sphere` parseável

Quando detectado:
1. Faz merge dos valores novos em `receitas[ultimo].eyes.{od,oe}`
2. Recalcula `rx_type` (perto/adição → progressive, senão single_vision)
3. Marca `source: "client_correction"`, `confidence: 0.99`, `data_leitura` agora
4. Persiste em `contatos.metadata.receitas`
5. Reescreve `receitaCtx` com tag `⚠️ CORRIGIDA PELO CLIENTE`
6. Injeta hint obrigatório: reconhecer correção + chamar `consultar_lentes` com valores novos
7. Loga `receita_corrigida_pelo_cliente` em `eventos_crm`

## Padrões parseados
- `OD <esf> com <cil> [eixo <axis>] [add <add>]`
- `OD: esf -9 cil -2,75 eixo 180 add +2,00`
- `LONGE: OD 0.00 com -2,25` / `PERTO: -0,25 com -2,00 eixo 180`
- Aceita vírgula ou ponto decimal, sinal opcional

## Salvaguardas
- Só age se já existe receita salva (correção, não primeira leitura)
- Mantém valores antigos se cliente só corrige um campo (merge parcial)
- Hint força reconhecimento curto da correção antes do orçamento (UX)
