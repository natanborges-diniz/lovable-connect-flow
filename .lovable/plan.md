## Plano final: Confirmação pós-OCR + CTA agendamento + escolha hierárquica cidade → loja

### Fluxo

```text
Foto → interpretar_receita → pending_confirmation=true
   ▼
IA pergunta: "Li assim, confere? OD ... OE ..."
   ▼
 ┌─ "sim" ────────────┐    ┌─ correção ─────┐
 │ confirmed_at       │    │ atualiza valores│
 │ → consultar_lentes │    │ pending=true   │
 │   (mesmo turno)    │    │ re-pergunta    │ (loop)
 └────────┬───────────┘    └────────────────┘
          ▼
   2-3 opções (DNZ/DMAX/HOYA) + R$
   + CTA: "Quer agendar uma visita pra ver pessoalmente? 😊"
          ▼
   ┌─ "sim" ──┐         ┌─ "não/depois" → despedida + silêncio
   ▼
   IA envia LISTA DE CIDADES:
     🏙️ Osasco
     🏙️ Carapicuíba
     🏙️ Itapevi
     🏙️ Barueri
     "Em qual cidade fica melhor pra você?"
          ▼
   cliente escolhe cidade
          ▼
   ┌─────────────────────────────────────────────────────┐
   │ Osasco (6 lojas) → IA lista as 6 c/ endereço:       │
   │   🏬 *DINIZ ANTONIO AGU* — {endereco} ({horário})   │
   │   🏬 *DINIZ PRIMITIVA I* — ...                       │
   │   🏬 *DINIZ PRIMITIVA II* — ...                      │
   │   🏬 *DINIZ STO ANTONIO* — ...                       │
   │   🏬 *DINIZ SUPER SHOPPING* — ...                    │
   │   🏬 *DINIZ UNIÃO* — ...                             │
   │   "Qual fica melhor pra você?"                       │
   │                                                      │
   │ Carapicuíba → loja única DINIZ CARAPICUIBA           │
   │   IA já confirma a loja + endereço + pergunta dia/hora│
   │                                                      │
   │ Itapevi → loja única DINIZ ITAPEVI (mesmo padrão)    │
   │ Barueri → loja única DINIZ BARUERI (mesmo padrão)    │
   └─────────────────────────────────────────────────────┘
          ▼
   cliente escolhe loja (ou já vem definida) → pergunta dia/hora
          ▼
   agendar_visita / agendar_cliente → confirmação → despedida
```

### Mapeamento cidade → lojas (hardcoded no código + memória)

| Cidade        | Lojas                                                                                                       |
|---------------|-------------------------------------------------------------------------------------------------------------|
| Osasco        | DINIZ ANTONIO AGU, DINIZ PRIMITIVA I, DINIZ PRIMITIVA II, DINIZ STO ANTONIO, DINIZ SUPER SHOPPING, DINIZ UNIÃO |
| Carapicuíba   | DINIZ CARAPICUIBA                                                                                           |
| Itapevi       | DINIZ ITAPEVI                                                                                               |
| Barueri       | DINIZ BARUERI                                                                                               |

Dados (endereço, horário) buscados em `telefones_lojas WHERE nome_loja IN (...) AND tipo='loja' AND ativo=true`. Match por nome (sem precisar de coluna `cidade`). Se faltar endereço/horário no banco, IA mostra só o nome (degradação graciosa).

### Regras

1. Auto-chain `consultar_lentes` só após "sim" da receita.
2. Correção atualiza valores e re-pergunta; nunca pede foto novamente.
3. CTA agendamento entra no MESMO turno das opções.
4. CTA aceito → IA envia **lista de cidades** (não lojas).
5. Cidade com >1 loja (Osasco) → 2º passo: lista de lojas da cidade.
6. Cidade com 1 loja (Carapicuíba/Itapevi/Barueri) → pula direto pra dia/hora ("Beleza! Será na DINIZ {nome} — {endereço}. Qual dia e horário ficam bons?").
7. CTA recusado → despedida + silêncio (`pos-agendamento-silencio`).
8. Cliente já cita cidade/loja específica antes da pergunta → IA atalha pro passo correspondente (skip lista).

### Mensagens canônicas

- **Confirmação receita (1ª):** "Li sua receita assim, confere? 😊\n👁️ OD: ESF {esf} CIL {cil} EIXO {eixo}°{add}\n👁️ OE: …\nEstá certinho?"
- **Após correção:** "Anotei! Ficou assim:\n👁️ OD: …\n👁️ OE: …\nAgora tá certo? ✅"
- **CTA agendamento (sufixo de `runConsultarLentes`):** "Posso agendar uma visita pra você ver pessoalmente e fechar o pedido? 😊"
- **Lista de cidades:** "Boa! Atendemos nessas cidades, qual fica melhor pra você visitar?\n\n🏙️ Osasco\n🏙️ Carapicuíba\n🏙️ Itapevi\n🏙️ Barueri"
- **Lojas de Osasco:** "Em Osasco temos essas unidades:\n\n🏬 *DINIZ ANTONIO AGU* — {endereco} ({horário})\n🏬 *DINIZ PRIMITIVA I* — …\n…\n\nQual fica melhor pra você?"
- **Cidade com loja única:** "Beleza! Será na *DINIZ {nome}* — {endereco} ({horário}).\nQual dia e horário ficam bons pra sua visita?"

### Mudanças em `supabase/functions/ai-triage/index.ts`

1. `interpretar_receita`: remove auto-chain; salva `pending_confirmation: true`; resposta = `MSG_CONFIRMAR_RECEITA(rxData, isCorrection:false)`.
2. `detectRxConfirmation` — regex `/^(sim|confere|isso|perfeito|certinho|correto|exato|tá certo|ok|positivo|👍|👌|✅)/i` com guarda anti-"não/errad".
3. Hook `detectPrescriptionCorrection`: aplica correção, mantém `pending=true`, incrementa `correction_count`, devolve `MSG_CONFIRMAR_RECEITA(...,isCorrection:true)`. NÃO dispara `consultar_lentes`.
4. `forcedIntent`: receita pendente + "sim" → marca `confirmed_at`, força `consultar_lentes`.
5. Bloqueio `consultar_lentes` com `pending_confirmation===true` → devolve confirmação atual.
6. `runConsultarLentes`: acrescenta sufixo `MSG_CTA_AGENDAMENTO`; marca `metadata.cta_agendamento_enviado_at`.
7. `detectAgendamentoConfirmacao` — disparado quando `cta_agendamento_enviado_at` existe e ainda não há agendamento → `enviarListaCidades(contato)`.
8. **Novo `enviarListaCidades`** — texto fixo `MSG_LISTA_CIDADES` (4 cidades hardcoded). Marca `metadata.cidades_enviadas_at`.
9. **Novo `detectEscolhaCidade`** — regex sobre `lista_cidades_enviadas_at` ativo. Match em "osasco|carapicuíba|carapicuiba|itapevi|barueri":
   - Osasco → `enviarLojasOsasco()` (busca em `telefones_lojas` as 6 lojas, ordena, formata). Marca `metadata.lojas_enviadas_at`, `metadata.cidade_escolhida='osasco'`.
   - Demais → `confirmarLojaUnicaECidadeUnica(cidade)` (carrega 1 loja, manda `MSG_CIDADE_LOJA_UNICA` + pergunta dia/hora). Marca `metadata.loja_escolhida=…`, `metadata.aguardando_data_hora_at`.
10. **Novo `detectEscolhaLoja`** — quando `lojas_enviadas_at` ativo + match em nome de loja → injeta hint forçando próximo passo (perguntar dia/hora). Marca `metadata.loja_escolhida=…`.
11. CTA recusado ("não/depois/vou pensar") → despedida + silêncio.
12. Atalho: se cliente, antes de qualquer pergunta, citar cidade/loja → pula etapas correspondentes.
13. Eventos `eventos_crm`: `receita_confirmacao_solicitada`, `receita_corrigida_pelo_cliente`, `receita_confirmada_cliente`, `cta_agendamento_enviado`, `cta_agendamento_aceito`, `cta_agendamento_recusado`, `cidades_enviadas`, `cidade_escolhida`, `lojas_osasco_enviadas`, `loja_escolhida`.

### Pré-requisito de dados

`telefones_lojas` precisa ter `endereco` e `horario` para as 9 lojas. Verifico antes de codar; se faltar, sugiro migração de seed (sem bloquear — IA mostra só nome se faltar).

### Arquivos afetados

- `supabase/functions/ai-triage/index.ts` — itens 1-13.
- 1 migração SQL — correção pontual receita Jennifer (`0c02bf09-…`) com OD -21,50/-0,50/180° e OE -13,00/-1,00/145°, `confirmed_at: now()`, `confidence: 1.0`.
- (Opcional) seed `telefones_lojas` se faltar endereço/horário.
- `mem://ia/auto-receita-e-anti-loop.md` — nova seção "Confirmação pós-OCR + CTA + escolha cidade→loja (Mai/2026)".
- `mem://ia/correcao-receita-por-texto.md` — correção dispara re-pergunta, não confirma.
- `mem://ia/pos-agendamento-silencio.md` — adiciona "CTA recusado = silêncio".
- `mem://ia/base-conhecimento-lojas.md` — registra mapeamento cidade→loja (Osasco x6, demais x1).

### O que NÃO muda

Modelo único `openai/gpt-5`, threshold `0.80`, sem segunda LLM, custo zero. `agendar_visita`/`agendar_cliente`, Hoyalux D+, anti-loop Fases 1-4, watchdogs, despedida pós-agendamento, lembretes — nada.

---

Aprova essa versão? Aprovado, troco pra build mode e implemento.