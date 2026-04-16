

O usuário levantou um ponto crítico:
- Operador abre demanda da conversa do cliente → a conversa está em modo humano
- Loja responde → vai direto pro cliente? Ou pro operador filtrar?
- Direto pro cliente = perigoso (sem filtro, loja pode mandar coisa errada)

Resposta clara: **canal operador ↔ loja, NUNCA loja → cliente direto**. O operador é o filtro obrigatório.

# Plano: Demanda à Loja — Canal Privado Operador ↔ Loja

## Princípio Central

A demanda é uma **conversa paralela e privada entre operador e loja**. A resposta da loja **NUNCA chega ao cliente automaticamente**. O operador lê, valida, edita se preciso, e decide o que repassar.

## Pré-condição

O operador só vê o botão "📌 Solicitar à Loja" quando o atendimento está em **modo humano** (já assumido por ele ou pela fila). Em modo IA, o botão fica oculto — não faz sentido a IA pedir foto à loja.

## Fluxo Visual

```text
┌─────────────────────────────────────────────────────────────────┐
│  CONVERSA DO CLIENTE (modo humano)                              │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Cliente: "Tem a armação Ray-Ban RB4171 na loja Osasco?"  │   │
│  │ Operador: [pensando...]                                   │   │
│  │                                                           │   │
│  │ [📌 Solicitar à Loja]  ← botão só aparece em modo humano │   │
│  └──────────────────────────────────────────────────────────┘   │
│                          │                                       │
│                          ▼                                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ PAINEL LATERAL "Demandas à Loja" (privado, só operador)  │   │
│  │ ─────────────────────────────────────────────────────    │   │
│  │ #DEM-42 • Loja Osasco • aberta                           │   │
│  │ ► "Tem foto da Ray-Ban RB4171?"                          │   │
│  │ ◄ Loja: "Sim, tenho. Segue foto." [📷 imagem]            │   │
│  │ ◄ Loja: "R$ 890 à vista ou 10x R$ 95"                    │   │
│  │                                                           │   │
│  │ [✏️ Encaminhar ao cliente] [📝 Editar antes] [✓ Encerrar]│   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
        Operador clica "Encaminhar ao cliente"
        (pode editar texto, escolher quais anexos)
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  CONVERSA DO CLIENTE (continua)                                  │
│  Operador → Cliente: "Sim, temos! R$ 890 à vista." [📷 foto]    │
└─────────────────────────────────────────────────────────────────┘
```

## Arquitetura — 3 conversas separadas

```text
1. ATENDIMENTO CLIENTE (público)     ← Cliente vê tudo aqui
   └─ mensagens entre cliente e operador

2. DEMANDA LOJA (privado)            ← Só operador e loja veem
   └─ mensagens entre operador e loja
   └─ vinculada ao atendimento_id do cliente para contexto

3. BOT-LOJAS (corporativo normal)    ← Loja usa pra pagamento/boleto
   └─ não interfere nas demandas
```

## Roteamento (resolve o problema do chaveamento)

Quando a loja responde no WhatsApp, o `whatsapp-webhook` decide:

| Condição | Destino |
|----------|---------|
| Mensagem começa com `#42` ou cita demanda via reply | → Demanda #42 (operador é notificado) |
| Loja digita "menu" ou texto livre sem código | → bot-lojas mostra menu COM opção extra "📌 Tem 2 demandas pendentes — responder?" |
| Loja escolhe "responder demanda" no menu | → próxima msg vai pra demanda escolhida |
| Loja escolhe "outras opções" | → menu corporativo normal (pagamento/boleto/TI) |

**Sem janela de tempo.** Demanda fica aberta até operador encerrar. Loja pode responder no dia seguinte usando `#42`.

## UI no Atendimento

Aba lateral nova "📌 Demandas" dentro do dialog de atendimento:
- Lista demandas abertas/respondidas para esse cliente
- Botão "Nova demanda" → modal: escolhe loja + texto + foto opcional
- Cada demanda mostra thread privada com a loja
- Botão **"Encaminhar resposta ao cliente"** com editor (operador pode reescrever, escolher anexos)
- Badge no header "📌 Loja respondeu" quando tem msg nova não vista

## Mensagem que chega na loja

```
📌 *DEMANDA DEM-2026-00042*
Operador: João (CRM)
Cliente: Maria Silva

Tem foto da armação Ray-Ban RB4171 e disponibilidade?

────────────
💬 Para responder, comece com *#42*
🔄 Para abrir o menu corporativo, digite *menu*
```

## Garantias de Segurança

1. **Loja não conhece o número do cliente** — só vê "Cliente: Maria Silva"
2. **Resposta da loja nunca chega ao cliente automaticamente** — sempre passa pelo operador
3. **Operador vê quem é a loja, loja vê quem é o operador** — rastreável
4. **Anexos da loja ficam no painel privado** até operador escolher encaminhar
5. **Modo IA bloqueia o botão** — só operador humano pode abrir demanda

## Componentes a criar

| Arquivo | Função |
|---------|--------|
| Migration `demandas_loja` + `demanda_mensagens` | Threads privadas operador↔loja |
| `criar-demanda-loja/index.ts` (EF) | Cria demanda + envia WA formatado |
| `encaminhar-demanda-cliente/index.ts` (EF) | Operador encaminha resposta ao cliente |
| `whatsapp-webhook` (ajuste) | Detectar `#NN` antes de rotear pro bot-lojas |
| `bot-lojas` (ajuste) | Injetar opção "responder demanda" no menu se houver pendente |
| `Atendimentos.tsx` | Aba "Demandas" + botão "Solicitar à Loja" (visível só em modo humano) |
| `DemandaLojaPanel.tsx` (novo) | Thread privada + botão encaminhar |
| `mem://bot-lojas/canal-demandas-privado` | Documentar regra "nunca direto ao cliente" |

## Decisões já tomadas

- ✅ Canal **privado** operador↔loja (não direto ao cliente)
- ✅ Disponível só em **modo humano**
- ✅ Roteamento por **protocolo `#NN`** (sem janela de tempo)
- ✅ Bot-lojas continua funcionando normalmente em paralelo
- ✅ Operador é filtro obrigatório antes de qualquer info chegar ao cliente

