## Resposta

A mudança é **só aqui no Atrium**, em uma linha do banco. Não toca no InFoco Messenger.

## O que muda no fluxo `confirmacao_pix`

**Hoje (3 perguntas em texto):**
1. Valor do PIX
2. Data/hora aproximada
3. Nome do cliente

**Depois (1 pergunta, com print):**
1. Foto/print do comprovante do PIX (aceita 1 ou mais imagens)

O motor `bot-lojas` já suporta nativamente `tipo_input: "imagem"`, com loop "deseja enviar mais um comprovante? SIM/NÃO" e arquivamento automático em `comprovantes/{ano}/{protocolo}/`. Sem nenhuma alteração de código.

## Detalhes técnicos

Um único `UPDATE` em `bot_fluxos WHERE chave='confirmacao_pix'`:

- `etapas` passa a ter 1 item:
  - `campo: "comprovante"`, `tipo_input: "imagem"`, `obrigatorio: true`
  - mensagem: "📸 Envie o *print do comprovante do PIX* (pode mandar mais de um se precisar)."
- `acao_final.template_confirmacao` reescrito para não citar valor/data/cliente:
  - "✅ Comprovante de PIX recebido! O financeiro vai validar e te retorna em instantes."
- `acao_final.tipo` continua `criar_solicitacao` e `tipo_solicitacao: confirmacao_pix` — ticket segue para a coluna "Confirmação PIX".

O comprovante já é arquivado em `solicitacao_anexos` (tipo=`comprovante`) e fica visível no card do financeiro junto com o protocolo. O atendente lê o print direto e confirma — sem digitação manual da loja.

## Fora do escopo

- Nenhuma migration, nenhuma edge function nova.
- Nenhum ajuste no InFoco Messenger (anexos já aparecem na timeline da solicitação via `solicitacao_anexos`).
- OCR automático do comprovante fica para depois (se a operação pedir).
