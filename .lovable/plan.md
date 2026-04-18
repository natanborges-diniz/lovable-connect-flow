
Ajuste fino: a frase "Consultor especializado" **já existe** como abertura natural da IA — não preciso adicionar/forçar isso no exemplo. O exemplo modelo deve mostrar apenas o que vem **depois** dela (as opções + região), porque é aí que a IA está travando.

## Plano revisado

### Frente 1 — Resposta manual ao Guilherme
Buscar opções em `pricing_lentes_contato` compatíveis com a receita salva (metadata.receitas[ultimo]) e enviar via `send-whatsapp` no atendimento ativo, remetente "Gael":

> "Oi Guilherme! Pela sua receita tenho 3 opções de LC:
> 1) **[Diária X]** R$ A/cx — *pra esporte é a mais indicada (sem estojo, sem solução, zero risco com suor)* 🏃
> 2) **[Quinzenal Y]** R$ B/cx (combo 3+1 R$ C, ~6 meses por olho)
> 3) **[Mensal Z]** R$ D/cx (combo 3+1 R$ E, melhor custo no longo prazo)
>
> Qual região você fica? Te indico a unidade pra retirada 😉"

### Frente 2 — Correção em `ai-triage`
Estender o hint pós-receita atual (hoje só `consultar_lentes`):
- Detectar contexto LC ("lente de contato", "LC", "diária/quinzenal/mensal", "tórica") → forçar `consultar_lentes_contato`.
- Apresentar **2-3 opções com descartes variados** (mín. 2 categorias).
- Esporte/academia/futebol/natação → frase consultiva recomendando diária, **sem omitir** quinzenal/mensal.

### Frente 3 — Aprendizado (DB)
**`ia_regras_proibidas`** (categoria `comportamento`):
> "Quando cliente perguntar sobre LC E houver receita salva, é obrigatório usar `consultar_lentes_contato` e apresentar 2-3 opções com descartes variados (diária + quinzenal + mensal) na mesma resposta. Nunca encerrar pedindo só marca/tipo se já há receita. Esporte → recomendar diária como dica, sem omitir as outras. Cilindro ≥0.75 → tóricas (sob encomenda)."

**`ia_exemplos`** (categoria `pos_receita_lc_esporte`) — começa direto nas opções, sem repetir o gancho do Consultor:
- pergunta: "Tem lente de contato? Uso pra esporte [receita salva]"
- resposta_ideal: "Pela sua receita tenho 3 opções: 1) [Diária A] R$ X/cx — *pra esporte é a mais indicada (sem estojo, sem solução, zero risco com suor)* 🏃; 2) [Quinzenal B] R$ Y/cx ou combo 3+1 R$ Z; 3) [Mensal C] R$ W/cx (melhor custo longo prazo). Qual região você fica? Te indico a loja 😉"

### Frente 4 — Memória
Atualizar `mem://ia/lentes-de-contato-orcamento.md`:
- Pós-receita LC = mesmo fluxo obrigatório de óculos (tool → opções → região → agendar).
- Esporte = dica consultiva, nunca filtro exclusivo. Sempre ≥2 categorias de descarte.
- Caso Guilherme documentado.

## Sem mudanças
Migrações/UI: nenhuma. Só `ai-triage` (hint expandido) + 2 inserts (regra + exemplo) + envio manual.

## Resultado
- Guilherme recebe leque completo hoje.
- IA mantém naturalidade da abertura sobre Consultor, mas obrigada a entregar as opções logo em seguida.
- Esporte vira dica consultiva embutida, sem podar opções.
