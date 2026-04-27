## Diagnóstico

Paulo pediu cotação de menor custo (AR + uma com fotossensível), mandou receita (OD 0/-2.00, OE 0/-2.50). Sequência do que deu errado às 16:48-16:53:

1. Operador mandou às 16:48 três marcas (DNZ HDI, DMAX BlueGuard, HOYA) **sem valores**.
2. Cliente: "Quero orçamento da 1 e 2".
3. Hint "REFERÊNCIA A OPÇÃO" foi injetado, mas a IA chamou `consultar_lentes` mesmo assim e devolveu **Eyezen + ZEISS R$1.985-2.190** — exatamente as opções caras.
4. Validador rejeitou follow-up; saiu "Me explica melhor..." 3× em loop.

## Causa real, confirmada no banco

Consultei `pricing_table_lentes` para single_vision com OD 0/-2.00 OE 0/-2.50:

| Marca/Família           | Índice | Tratamento       | Filtro Azul | Foto | Preço     |
|-------------------------|--------|------------------|-------------|------|-----------|
| DNZ HDI                 | 1.67   | AR Verde         | -           | -    | R$ 520    |
| DNZ Free Form           | 1.67   | AR Verde         | -           | -    | R$ 690    |
| ZEISS SmartLife Ind 3   | 1.5    | DuraVision Chrome| Sim         | -    | R$ 1.490  |
| ZEISS SmartLife Ind 3   | 1.5    | DuraVision Silver| Sim         | -    | R$ 1.949  |
| ESSILOR Eyezen Start    | Orma   | Crizal Prevencia | Sim         | -    | R$ 1.985  |
| ESSILOR Eyezen Boost    | Orma   | Crizal Prevencia | Sim         | -    | R$ 2.135  |

Dois fatos críticos:
- **DMAX e HOYA não estão cadastrados em single_vision** para esse grau — o operador citou de memória, mas a tool não retorna.
- **Zero opções fotossensíveis** disponíveis para esse grau no catálogo (filtro `photo=true` retorna 0 linhas).

A tool pega `lenses[0]` (econômica = DNZ R$520), `lenses[mid]` (intermediária) e `lenses[last]` (premium). Como o catálogo dá um salto enorme R$690 → R$1.490, qualquer apresentação "3 opções" mistura entrada DNZ com ZEISS/ESSILOR caríssimos.

## Ação 1 — Recuperação manual do Paulo (mensagem WhatsApp)

Enviar via interface humana ou via `send-whatsapp` na atendimento `26464d89`:

```
Paulo, voltando aqui com os valores certinhos pra sua receita
(OD 0,00 / -2,00 e OE 0,00 / -2,50) 🙏

🟢 OPÇÃO MAIS EM CONTA — antirreflexo
*DNZ HDI 1.67 com AR Verde* — R$ 520,00
Lente fina (índice 1.67, ideal pro seu grau), com antirreflexo
verde de boa durabilidade.

🟡 UM PASSO ACIMA — antirreflexo premium
*DNZ Free Form 1.67 com AR Verde* — R$ 690,00
Mesma lente fina, mas em tecnologia Free Form (visão mais nítida
nas laterais).

📌 Sobre a fotossensível: pra esse seu grau específico, no
momento o estoque de transitions/fotossensível está sob consulta
em loja — dá pra confirmar disponibilidade e preço quando você
passar pessoalmente.

Posso já agendar pra você passar na nossa loja Osasco Centro
(Rua Antônio Agu, 200) pra fechar a lente e a gente conferir a
armação? Que dia/horário fica melhor?
```

(Se humano preferir mandar via UI, esse é o texto pronto.)

## Ação 2 — Tampar 2 buracos confirmados no `ai-triage`

### 2.a — Hint "REFERÊNCIA A OPÇÃO" não está bloqueando `consultar_lentes`
Linha 2416-2422: o hint pede "NÃO rode consultar_lentes de novo", mas é só texto no system message. O LLM ignorou e rodou mesmo assim. **Fix:** quando o detector dispara, **forçar** `tool_choice: { type: "function", name: "responder" }` na chamada do gateway (não deixar a decisão ao LLM). Mesma técnica já usada em outros short-circuits.

### 2.b — Catálogo single_vision faltando DMAX e HOYA
Não é bug de código — é gap de dados. **Fix:** registrar evento e abrir nota pro time popular `pricing_table_lentes` com:
- DMAX BlueGuard 1.60 (filtro azul) faixa entrada
- HOYA Hi-Vision LongLife 1.67 (premium real)
- Pelo menos 1 fotossensível (Transitions) entry-level pra single_vision

Sem isso, qualquer cliente miopia simples vai receber salto R$690 → R$1.490 e operadores vão continuar citando marcas que a tool não conhece.

## Ação 3 — Correções menores no template

Em `runConsultarLentes` (linha 3877-3885), quando há **menos de 3 lentes distintas e há gap de preço >2× entre econômica e premium**, mostrar só a(s) econômica(s) e adicionar linha:
"Temos opções premium a partir de R$ X — quer que eu detalhe ou prefere ver pessoalmente na loja?". Evita o efeito "te mandei DNZ R$520 e ZEISS R$1.949 lado a lado", que parece esquisito comercialmente.

## Arquivos afetados

- `supabase/functions/ai-triage/index.ts` — Ação 2.a (forçar `tool_choice=responder` quando referência a opção é detectada) e Ação 3 (template com gap-aware).
- `pricing_table_lentes` — Ação 2.b (gap de catálogo, **não vou inserir sem aprovação dos preços reais** — apenas registrar evento e flag).
- `eventos_crm` — auditoria do caso Paulo.
- Mensagem manual ao Paulo via `send-whatsapp` (atendimento `26464d89`).

## Resultado esperado

- Paulo recebe orçamento real de entrada (R$520 / R$690) com transparência sobre fotossensível.
- Próxima vez que cliente disser "da 1 e 2" referenciando orçamento humano, IA é forçada a responder com `responder` (sem rodar tool nova).
- Operadores ficam cientes do gap DMAX/HOYA/Transitions no catálogo.
