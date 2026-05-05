---
name: Fluxo de encerramento de atendimento
description: Detectores determinísticos de despedida no ai-triage — encerramento explícito, agradecimento pós-agendamento, dispensa de ajuda, e dedup de despedida.
type: feature
---

## Detectores em `ai-triage/index.ts`

| Flag | Quando dispara | Resposta canônica |
|---|---|---|
| `isExplicitClose` | Cliente pede ENCERRAR explicitamente: "encerrar atendimento", "pode encerrar", "finalizar", "fechar", "encerra aí", "já resolveu", "era isso obrigado" | `Foi um prazer te atender, {nome}! 🙏 Obrigado pelo contato{ — te espero {agendamentoFmt}}. Qualquer coisa, é só me chamar 👋` |
| `isThanksClose` | `hasAgendamentoAtivo` + agradecimento puro ("obg", "valeu") sem ter sido perguntado "posso ajudar?" | `De nada, {nome}! Te espero {agendamentoFmt} 👋 Qualquer dúvida é só me chamar.` |
| `isShortNoToHelp` | Cliente diz "não" após pergunta canônica "posso ajudar em mais alguma coisa?" OU agradecimento puro com agendamento ativo | `Combinado, {nome}! Te espero {agendamentoFmt} (ou "Qualquer coisa estou por aqui") 👋 Qualquer dúvida é só me chamar.` |
| `isShortNo` | "não" curto em contexto de oferta pendente / pergunta de ajuda / agendamento ativo | `Tranquilo, {nome}! Posso te ajudar em mais alguma coisa antes de finalizar?` |

## Anti-duplicação (CLOSE-DEDUP)

Se o último outbound já contém uma das frases canônicas (`Foi um prazer te atender`, `Te espero`, `Qualquer coisa estou por aqui` + `Qualquer dúvida/coisa é só me chamar`) e o cliente responde curto ("Obg", "Não", "Encerrar"), o reenvio é silenciado e logado em `eventos_crm.tipo='despedida_duplicada_evitada'`.

## Branding

Toda frase é assinada como Óticas Diniz (no contexto do prompt do sistema). Nunca mencionar "Atrium" ao cliente final.
