# Contador de não lidos na aba do navegador

Objetivo: quando chegar mensagem interna nova, demanda nova de loja ou notificação, o título da aba passa a mostrar `(N) InFoco Messenger` — igual ao WhatsApp Web da imagem. Assim o usuário vê o número mesmo com a aba em segundo plano.

## O que muda pro usuário

- Título da aba passa de `InFoco Messenger` para `(3) InFoco Messenger` quando houver 3 itens não vistos.
- Contador some assim que o usuário volta pra aba **e** abre o item (mensagem/demanda/notificação).
- Também pisca o favicon com um pontinho vermelho (opcional, mesmo padrão do WhatsApp).
- Se o navegador/SO suportar (Chrome desktop, PWA instalado), aparece o número no ícone do app na barra de tarefas / dock via Badging API.

## Escopo do que conta como "não lido"

Somando três fontes já existentes no sistema:

1. **Mensagens internas não lidas** — soma de `nao_lidas` do hook `useMensagensInternas` (1-a-1 + grupos).
2. **Demandas de loja pendentes pro usuário** — itens ativos em `demandas_loja` que o usuário precisa agir (mesma regra que hoje já pinta o badge do menu Demandas).
3. **Notificações não lidas** — `notificacoes.lida = false` do usuário logado (hook `useNotificacoes`).

O número no título é a **soma dos três**. Não separa por tipo (fica igual WhatsApp: um número só).

## Como será feito (técnico)

1. Novo hook `useUnreadTotal()` em `src/hooks/useUnreadTotal.ts`:
   - Consome `useMensagensInternas`, `useNotificacoes` e uma query leve de demandas pendentes.
   - Devolve `{ total, porFonte }`.
   - Reaproveita os canais realtime já existentes (nada de nova subscription duplicada).

2. Novo componente `TabBadgeManager` (sem UI) montado no `AppLayout`:
   - Escuta `useUnreadTotal`.
   - Atualiza `document.title` prefixando `(N) ` quando `total > 0`.
   - Chama `navigator.setAppBadge(total)` / `clearAppBadge()` quando disponível (silenciosamente ignora se não suportado).
   - Troca o favicon por versão com "dot" vermelho quando `total > 0` (2 arquivos SVG em `public/`).

3. Detecção de foco:
   - Usa `document.visibilityState` — quando o usuário está com a aba ativa E já viu tudo, limpa. A limpeza natural acontece porque os próprios hooks (`marcarLidas`, abrir demanda, marcar notificação lida) já derrubam o contador.

4. Título base:
   - Lê do `<title>` atual (definido em `index.html`) pra não hardcodar "InFoco Messenger" no componente.

## Fora de escopo (fica pra depois se pedir)

- Som de notificação na aba.
- Notificação nativa do navegador (Web Push já existe em outro fluxo — não mexo aqui).
- Separar contador por seção no menu lateral (isso já existe hoje item a item).
- Mudar cor do favicon por tipo de item.

## Arquivos que serão criados/editados

- **criar** `src/hooks/useUnreadTotal.ts`
- **criar** `src/components/layout/TabBadgeManager.tsx`
- **criar** `public/favicon-badge.svg` (favicon com dot vermelho)
- **editar** `src/components/layout/AppLayout.tsx` (montar `<TabBadgeManager />`)

Nenhuma mudança de banco, nenhuma edge function nova, nenhuma migration.
