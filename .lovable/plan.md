

## Pergunta do usuário
Onde ficam visualmente as conversas das demandas com a loja?

## Resposta direta (sem mudanças de código)

A thread da demanda **não fica no card do CRM do cliente**. Ela vive em um painel próprio dentro do atendimento do cliente que originou a demanda. Mapa atual:

### 1. Onde aparece
- **Tela `Atendimentos`** (`/atendimentos`) → abre um atendimento de cliente que já tem demanda criada → no painel lateral aparece o componente **`DemandaLojaPanel`** listando todas as demandas vinculadas àquele atendimento (com badge de status: aberta / respondida / encerrada).
- Clicando numa demanda da lista, abre o **`DemandaThreadDialog`** — modal com a thread completa (mensagens `operador→loja`, `loja→operador`, `sistema`), botão "Encerrar demanda" e textarea "Encaminhar ao cliente".

### 2. Onde os dados moram
- Tabela `demandas_loja` → 1 linha por demanda (protocolo `DEM-AAAA-NNNNN`, status, vista_pelo_operador).
- Tabela `demanda_mensagens` → todas as mensagens da thread privada (não vão pra `mensagens` do CRM, não aparecem no chat do cliente).

### 3. O que NÃO acontece (e isso é proposital)
- A resposta da loja **não aparece** como mensagem no chat do cliente.
- A resposta da loja **não cria card no CRM** (com o hard-guard corporativo que acabamos de implementar).
- O operador é o filtro: lê na thread da demanda, edita se quiser, e clica "Encaminhar ao cliente" → aí sim vira mensagem no chat do cliente via `encaminhar-demanda-cliente`.

### 4. Fluxo visual

```text
/atendimentos
  └─ Atendimento do cliente "João" (card aberto)
      ├─ Chat principal (mensagens cliente↔operador/IA)
      └─ DemandaLojaPanel (lateral)
          ├─ DEM-2026-00001 [🟡 respondida] ← clica
          │     └─ DemandaThreadDialog
          │         • operador→loja: "Tem armação X em estoque?"
          │         • loja→operador: "Sim, R$ 450"
          │         • [Encaminhar ao cliente] [Encerrar demanda]
          └─ DEM-2026-00002 [⚪ encerrada]
```

### 5. Possíveis melhorias (se quiser, posso propor plano dedicado)
- Indicador no card do CRM ("📌 1 demanda aberta") pra operador saber sem entrar no atendimento.
- Aba "Demandas" no menu lateral global, listando todas as demandas pendentes pra todos operadores.
- Notificação in-app quando a loja responde uma demanda sua.

Quer que eu monte plano pra alguma dessas? Ou prefere validar primeiro o fluxo atual mandando uma resposta de teste pela Loja Teste?

