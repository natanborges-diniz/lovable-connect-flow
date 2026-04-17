

## Refinamento da Lógica de Combo e Tóricas

Atualizo o plano anterior com 2 correções críticas que você apontou:

### A) Lógica correta do combo "3+1" (baseada em unidades/caixa)

A planilha tem coluna `unidades_por_caixa` (6, 30, etc). A IA precisa raciocinar:

**Regra de cálculo de duração (mensais e quinzenais)**:
- Cada unidade dura 1 mês (mensal) ou 15 dias (quinzenal)
- Uma caixa = N unidades → N meses (mensal) ou N/2 meses (quinzenal) **por olho**
- Se mesma dioptria nos 2 olhos: 1 caixa atende ambos olhos → divide duração por 2
- Se dioptria diferente: 1 caixa por olho (mínimo 2 caixas)

**Exemplo prático (caixa de 6 unidades, mensal)**:
| Cenário | Caixas necessárias | Duração | Combo aplicável |
|---------|---|---|---|
| Mesma dioptria OD=OE | 1 caixa | 3 meses (6÷2) | 3+1 → 12 meses |
| Mesma dioptria OD=OE | 2 caixas | 6 meses | — |
| Dioptria diferente | 2 caixas (mín) | 6 meses (1 cx p/ olho) | — |
| Dioptria diferente | 4 caixas (3+1) | **12 meses (1 ano)** | ✅ Plano anual |

**Combo regra**: comprou 3 caixas → ganha a 4ª. Lógica do "plano anual":
- **Mesma dioptria** + 6un/cx: 3+1 = 4 cx → 12 meses (4 caixas × 6un ÷ 2 olhos = 12 meses)
- **Dioptria diferente** + 6un/cx: 3+1 = 4 cx → 12 meses (4 caixas × 6un ÷ 2 olhos = 12 meses)
- Diárias (caixas de 30/90): combo não se aplica (já vendidas em packs maiores)

### B) Detecção de tórica reformulada

Tórica não é só pelo nome — é pela **necessidade do cliente**:
- Se receita tem **cilíndrico ≥ |0.75|** em qualquer olho → **OBRIGATORIAMENTE** lente tórica
- Filtra apenas produtos com `is_toric = true` E que cubram o eixo da receita
- Aviso: "sob encomenda — pagamento confirma o pedido"

Lentes tóricas serão marcadas pela presença de `cylinder_min/max` na planilha (não nulo) OU pelo nome contendo "Toric"/"Astig"/etc.

## Mudanças no Plano

### Estrutura do banco (`pricing_lentes_contato`)
Adiciono colunas chave para a lógica:
- `unidades_por_caixa` (int) — 6, 30, 90
- `dias_por_unidade` (int) — 30 (mensal), 15 (quinzenal), 1 (diário)
- `is_toric` (bool) — derivado da planilha (cilindro disponível)
- `cylinder_min/max` (numeric) — range de cilindro coberto
- `cylinder_axes_disponiveis` (texto livre) — ex: "10° em 10°" ou "todos"

### Tool `consultar_lentes_contato` — lógica refinada
Recebe a receita (esférico OD/OE, cilíndrico OD/OE), determina:

1. **Precisa tórica?** Se `|cyl_OD| ≥ 0.75` OU `|cyl_OE| ≥ 0.75` → filtra `is_toric = true`
2. **Filtra por sphere/cylinder** dentro do range do produto
3. **Prioriza DNZ** quando compatível
4. **Calcula plano sugerido**:
   - Se mesma dioptria OD=OE (sph e cyl iguais) → "1 caixa atende os 2 olhos"
   - Se diferentes → "Mínimo 2 caixas (1 por olho)"
   - Sempre apresenta a opção 3+1 quando aplicável (mensais/quinzenais)
   - Calcula meses de duração e exibe: "4 caixas = 12 meses (1 ano completo)"
5. **Tóricas**: adiciona aviso "sob encomenda — pagamento confirma pedido"

### Bloco do prompt (`buildLentesContatoKnowledgeBlock`)
Inclui regra explícita para a IA raciocinar sobre o combo:

```
COMBO 3+1 (mensais/quinzenais):
- Cada caixa contém N unidades (ver unidades_por_caixa)
- 1 unidade = 1 mês (mensal) ou 15 dias (quinzenal) — POR OLHO
- Mesma dioptria OD/OE: 1 caixa atende ambos (divide duração por 2)
- Dioptria diferente: 1 caixa por olho (mínimo 2 caixas iniciais)
- Comprando 3 caixas, a 4ª é grátis (plano anual)
- Diárias: combo NÃO se aplica

TÓRICAS (astigmatismo):
- Cilíndrico ≥ 0.75 em qualquer olho → OBRIGATORIAMENTE tórica
- Sempre SOB ENCOMENDA — pagamento confirma o pedido
- Informar prazo estimado de entrega
```

### Saudação personalizada
(sem mudança do plano anterior — confirma nome se vier `senderName` válido, caso contrário pergunta)

## Arquivos a alterar

| Arquivo | Mudança |
|---|---|
| Migration `<timestamp>_lentes_contato.sql` | Cria tabela `pricing_lentes_contato` com colunas refinadas (unidades_por_caixa, dias_por_unidade, is_toric, cylinder ranges) |
| Migration data load | INSERT dos 50+ produtos da planilha com `unidades_por_caixa` correto |
| `supabase/functions/ai-triage/index.ts` | Remove escalação determinística de "lentes de contato"; adiciona tool `consultar_lentes_contato` com lógica de combo correta; adiciona bloco de conhecimento; ajusta `buildFirstContactBlock` para confirmar nome; adiciona tool `registrar_nome_cliente` |
| `supabase/functions/whatsapp-webhook/index.ts` | Helper `looksLikeRealName()`; flag `nome_confirmado` em metadata |
| Desativar regra proibida `lentes_de_contato` | UPDATE em `ia_regras_proibidas` |
| Nova regra: "Tóricas sob encomenda" | INSERT em `ia_regras_proibidas` |
| `mem://ia/lentes-de-contato-orcamento.md` | Documenta lógica de combo (mesma vs diferente dioptria), cálculo de duração, regra das tóricas (cyl ≥ 0.75) |
| `mem://ia/saudacao-confirma-nome.md` | Protocolo de saudação inicial |
| `mem://index.md` | Adiciona referências |

## Pendência da planilha
Vou ler o XLSX para confirmar:
- Coluna exata de "unidades por caixa" 
- Quais produtos têm cilíndrico disponível (= toric)
- Range de cilindro/eixo de cada um
- Se DNZ está separado por linha de produto

Posso prosseguir com essa implementação?

