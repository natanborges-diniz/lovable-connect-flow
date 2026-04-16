---
name: Canal Demandas Operador↔Loja (Privado)
description: Canal privado entre operador e loja para foto/disponibilidade de peça. Resposta da loja NUNCA chega ao cliente sem filtro do operador. Roteamento por #NN.
type: feature
---

# Canal "Demanda à Loja"

Canal **paralelo e privado** entre operador (CRM) e loja, vinculado ao atendimento de um cliente específico.

## Regras absolutas

1. **Resposta da loja NUNCA chega ao cliente automaticamente.** O operador é filtro obrigatório — lê, edita se preciso, e clica "Encaminhar ao cliente" via `encaminhar-demanda-cliente`.
2. **Botão "Solicitar à loja" só aparece em modo humano** no atendimento. IA não pode abrir demanda.
3. **A loja não vê o número do cliente** — apenas "Cliente: <nome>".

## Roteamento (sem janela de tempo)

A loja responde em **qualquer momento** (minutos ou dias depois) começando a mensagem com `#NN` (número curto sequencial gerado pela `demanda_numero_seq`). Aceita variações: `#42`, `# 42`, `#DEM-42`, `#dem42`.

Em `whatsapp-webhook`, antes de invocar `bot-lojas` ou `ai-triage`, a função `routeDemandaResposta` detecta o prefixo: se a loja tem demanda ativa e o número bate com o telefone, registra em `demanda_mensagens` (direção `loja_para_operador`) e marca `demandas_loja.status='respondida'` e `vista_pelo_operador=false`. **Pula completamente o bot-lojas.**

Sem prefixo? Cai no fluxo normal: bot-lojas (menu corporativo) ou triagem IA. Loja pode usar pagamento/boleto a qualquer momento sem afetar a demanda.

## Tabelas

- `demandas_loja`: protocolo `DEM-YYYY-NNNNN`, `numero_curto` (sequencial global, usado no `#NN`), `status` (aberta/respondida/encerrada), `vista_pelo_operador`, vincula `atendimento_cliente_id`.
- `demanda_mensagens`: thread privada (operador_para_loja, loja_para_operador, sistema), com `encaminhada_ao_cliente` para marcar mensagens já repassadas.

## Edge Functions

- `criar-demanda-loja`: valida modo humano, gera protocolo + número curto, envia WA formatado pra loja via `send-whatsapp` (com instrução `#NN` e `menu`), cria atendimento da loja se não existir.
- `encaminhar-demanda-cliente`: envia texto editado pelo operador para o atendimento do cliente via `send-whatsapp`, marca mensagens da loja como encaminhadas e adiciona nota sistema na thread.

## UI

Componente `DemandaLojaPanel` dentro do dialog de atendimento mostra lista de demandas + abre `DemandaThreadDialog` (thread privada com botão "Encaminhar ao cliente" e textarea editável; clicar em mensagem da loja seleciona-a e pré-preenche o texto a encaminhar).
