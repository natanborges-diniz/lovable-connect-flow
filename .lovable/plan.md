

## Plano: Restaurar Homologação + Loja de Teste

### Problema
- A "Loja Natan" (telefone `5511963268878`) foi removida da tabela `telefones_lojas`
- Sem ela, o número de teste passa na whitelist mas não é roteado para o bot-lojas
- As 9 lojas restantes têm telefones placeholder/reais mas nenhuma corresponde ao número de homologação

### O que será feito

1. **Reinserir a Loja Natan** na tabela `telefones_lojas` com o telefone correto `5511963268878` para que o roteamento loja → bot-lojas funcione em homologação

2. **Confirmar que o fluxo no webhook está correto**: a verificação de homologação (linha 329) roda antes do check de loja (linha 334). Se o telefone está na whitelist, `shouldSkipBot = false`, e então o `isLoja` check no passo 2.5 encontra a loja → aciona `bot-lojas`. O código já está correto para esse fluxo.

### Execução
- Um único INSERT na tabela `telefones_lojas` com os dados da Loja Natan
- Nenhuma alteração de código necessária — o webhook já suporta o fluxo

### Dados a inserir
| Campo | Valor |
|-------|-------|
| telefone | `5511963268878` |
| nome_loja | `Loja Natan` |
| departamento | `geral` |
| horario_abertura | `09:00` |
| horario_fechamento | `18:00` |
| ativo | `true` |

### Validação
Após inserir, enviar mensagem do número `5511963268878` e verificar nos logs da função `whatsapp-webhook` se aparece o roteamento para `bot-lojas` em vez de `ai-triage`.

