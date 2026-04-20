

## Racional dos dois projetos

Você tem **dois projetos React** apontando para o **mesmo banco Supabase** (`kvggebtnqmxydtwaumqz`):

| Projeto | Papel | Audiência |
|---|---|---|
| **infoco-ops** (este, `atrium-link`) | Plataforma operacional completa: CRM, Lojas, Financeiro, TI, Configurações, WhatsApp Meta, IA Gael, automações, cron, edge functions | Operadores internos no desktop/web |
| **Desktop Companion** (`Atrium Messenger`) | App enxuto e focado: só **Mensagens internas + Demandas + Notificações + Perfil** | Lojas e colaboradores no celular (PWA/native) |

Ambos escrevem/leem nas **mesmas tabelas** (`mensagens_internas`, `notificacoes`, `solicitacoes`), com RLS garantindo isolamento. É exatamente o modelo "Canal Único — App Atrium Messenger" que já está nas memórias.

```text
              ┌────────────────────────────┐
              │   Supabase (único backend) │
              │  kvggebtnqmxydtwaumqz      │
              │  • mensagens_internas       │
              │  • notificacoes             │
              │  • solicitacoes / profiles  │
              └──────────┬─────────────────┘
                         │
        ┌────────────────┴───────────────┐
        │                                │
┌───────▼──────────┐            ┌────────▼──────────┐
│  infoco-ops      │            │  Desktop Companion│
│  (operação web)  │            │  (Atrium Messenger│
│  desktop pesado  │            │   leve, mobile)   │
└──────────────────┘            └───────────────────┘
```

## O que fazer em cada lado

### No **Desktop Companion** (o outro projeto)
É **lá** que o app mobile do colaborador/loja vive. Ele já tem:
- Login → Lista de conversas → Chat 1:1 (com Realtime já validado)
- Lista de demandas (`solicitacoes`)
- Notificações
- Perfil

**Próximos passos naturais lá:**
1. Empacotar como **PWA + Capacitor** (mesmo modelo que acabamos de aplicar aqui) — porque é esse projeto que vai virar o app instalável de fato.
2. Registrar **push token** no `profiles.metadata.push_token` ao logar no celular → habilita o `dispatch-push` que já existe aqui.
3. Adicionar badge de não lidas + indicador de digitando.

### No **infoco-ops** (este projeto)
A página `/mensagens` daqui **continua existindo** como espelho desktop para os operadores que já estão no painel — não precisa virar app mobile. As alterações de Capacitor/PWA que acabei de fazer aqui são **opcionais** (servem se você quiser que operadores também instalem o painel inteiro no celular), mas o **caminho oficial mobile é o Desktop Companion**.

## Minha recomendação

1. **Aqui (infoco-ops)**: reverter (ou simplesmente ignorar) o setup Capacitor/PWA — este projeto é desktop-first, o `/mensagens` continua útil só para operadores no painel.
2. **Lá (Desktop Companion)**: aplicar o setup PWA + Capacitor + push tokens. É o app que será instalado nos celulares de loja/colaborador.
3. Deixar o `dispatch-push` daqui (já pronto, modo log-only) esperando o token aparecer em `profiles.metadata.push_token` — assim que o Desktop Companion começar a registrar tokens, o push real começa a fluir sem mexer em nada aqui.

## Memória a atualizar

Adicionar à `mem://arquitetura/canal-unico-meta-e-app-atrium`:
> "Atrium Messenger" tem projeto Lovable próprio (`Desktop Companion`, id `2d68a67b-…`) apontando para o mesmo Supabase. App mobile = Desktop Companion (PWA/Capacitor). `infoco-ops` mantém `/mensagens` apenas como espelho desktop para operadores.

## Pergunta de decisão

Quer que eu:
- **(A)** remova o Capacitor/PWA daqui e foque o setup mobile **no Desktop Companion** (recomendado), ou
- **(B)** mantenha aqui também (dois apps instaláveis: painel operacional + messenger), ou
- **(C)** primeiro vá ao Desktop Companion fazer o setup mobile lá e depois decidimos sobre este?

