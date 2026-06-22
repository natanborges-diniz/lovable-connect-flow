
## Objetivo

Dois fluxos complementares ligados à OS no Firebird:

1. **Recebimento manual no Atrium Messenger** — loja vê lista de OS com movimentação recente no banco e dá "Recebi" → cliente recebe notificação automática.
2. **Aviso automático D-1 → D 08h** — toda OS que entrou em `codEtapa=15` (Aguardando Armação) em D-1 dispara, no dia seguinte às 08:00 SP, template WhatsApp pedindo para o cliente trazer a armação.

Complementa (não substitui) o futuro aviso de "OS pronta para retirada" (codEtapa=5).

---

## 1. Recebimento de OS no Atrium Messenger

### Tabela nova `os_recebimento_loja`
| campo | tipo | descrição |
|---|---|---|
| `id` | uuid PK | |
| `os_numero` | text | |
| `loja_nome` | text | |
| `contato_id` | uuid (nullable) | resolvido por telefone do cliente da OS |
| `cod_etapa_atual` | int | snapshot no momento da ingestão |
| `etapa_label` | text | rótulo ERP |
| `produto_descricao` | text | usa `montarProdutoDescricao` do `os-status-public` |
| `data_movimentacao` | date | última movimentação no Firebird |
| `recebido_at` | timestamptz null | preenchido quando loja clica "Recebi" |
| `recebido_por` | uuid null | profile da loja |
| `notificado_cliente_at` | timestamptz null | quando o cliente recebeu o aviso |
| `metadata` | jsonb | payload bruto Firebird |

Único: `(os_numero, loja_nome)`. RLS: loja só vê suas linhas; admin/operador veem tudo.

### Cron diário de ingestão `regua-ingestao-os-loja` (06:30 SP)
- Lê do Firebird (via EF `os-status-public` em modo "lista") todas as OS com movimentação em D-1.
- Faz upsert em `os_recebimento_loja` (sem sobrescrever `recebido_at`).
- Resolve `contato_id` por telefone do cliente.

### UI Messenger (cross-project InFoco Messenger) — nova aba "OS para receber"
- Lista cards pendentes (`recebido_at IS NULL`) filtrados pela loja do usuário.
- Cada card: nº OS, cliente, produto (descrição sanitizada), etapa, data movimentação.
- Botão **"Confirmar recebimento"** → chama EF `confirmar-recebimento-os` do Atrium.

### EF nova `confirmar-recebimento-os`
- Marca `recebido_at` + `recebido_por`.
- Dispara template `os_recebida_loja` (UTILITY) ao cliente: "Sua OS {numero} chegou na {loja}. Em breve nossa equipe finaliza e te avisa."
- Loga em `eventos_crm`.
- Idempotente: se já recebida, retorna 200 sem reenviar.

### Templates novos (catálogo `whatsapp_templates`)
- `os_recebida_loja` (UTILITY) — vars: `{nome}`, `{os_numero}`, `{loja}`
- Aliases: `os_recebida_loja` → versão aprovada (gate em `send-whatsapp-template`)

---

## 2. Aviso D-1 → D 08h "traga a armação" (codEtapa 15)

### Ingestão diária
Reaproveita o mesmo cron de 06:30 SP. Para OS detectada em `codEtapa=15` com `data_movimentacao = D-1`:
- Cria touchpoint em `regua_touchpoint` com `tipo='aguardando_armacao_08h'`, `data_prevista = hoje`, `template_key='aviso_aguardando_armacao'`.
- Único `(inscricao_id, tipo)` evita duplicação.

### Cron disparo 08:00 SP `regua-disparo-aguardando-armacao`
- Seleciona touchpoints `tipo='aguardando_armacao_08h'`, `data_prevista=hoje`, `status='PENDENTE'`.
- Dispara template `aviso_aguardando_armacao` via `send-whatsapp-template` (UTILITY, sempre alias).
- Marca `enviado_at`, `status='ENVIADO'`.
- Anti-duplicação: skip se `notificado_em` já existe.

### Template novo
- `aviso_aguardando_armacao` (UTILITY) — vars: `{nome}`, `{os_numero}`, `{loja}`, `{endereco_loja}`
- Texto sugerido: "Oi {nome}! Sua OS {os_numero} já está com as lentes prontas e só falta a armação para finalizarmos. Passe na {loja} ({endereco_loja}) no horário que for melhor pra você. — Óticas Diniz"
- Alias: `aviso_aguardando_armacao`

---

## Decisões de design

- **Branding**: cliente final vê "Óticas Diniz". Atrium só na UI interna.
- **Horário comercial**: cron 08:00 SP; se loja fechada no dia (`loja_status_no_dia`), atrasa para próximo dia útil (skip + reagenda touchpoint).
- **Anti-spam**: cada OS recebe no máximo 1 aviso por etapa (uniq `regua_touchpoint(inscricao_id,tipo)`).
- **Gate de template**: `send-whatsapp-template` já bloqueia se status != approved; mensagem fica retida até aprovação Meta.
- **Memória**: criar `mem://regua/os-aguardando-armacao-e-recebimento-loja` documentando os dois fluxos.

---

## Entregáveis (ordem)

1. Migração: tabela `os_recebimento_loja` + grants + RLS + trigger updated_at; novos `tipo` permitidos em `regua_touchpoint`.
2. Templates: criar `os_recebida_loja` e `aviso_aguardando_armacao` em `whatsapp_templates` (rascunho) + aliases.
3. EF `regua-ingestao-os-loja` (cron 06:30) — ingestão Firebird → `os_recebimento_loja` + `regua_touchpoint`.
4. EF `confirmar-recebimento-os` (chamada do Messenger).
5. EF `regua-disparo-aguardando-armacao` (cron 08:00).
6. Schedules pg_cron via `manage-cron-jobs`.
7. UI no projeto **InFoco Messenger** (cross-project): nova rota `/os-para-receber`.
8. Documentação de memória + atualização do índice.

## Itens que ficam fora deste plano (próximo ciclo)

- Aviso de "OS pronta para retirada" (codEtapa=5) — herda o mesmo motor de touchpoint, só adicionar `tipo='os_pronta_retirada'`.
- Submissão e aprovação dos 2 templates na Meta (manual via Configurações).
