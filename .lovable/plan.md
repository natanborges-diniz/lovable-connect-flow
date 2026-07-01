## Objetivo

Dar ao supervisor multi-loja três recursos no **InFoco Messenger** (projeto `desktop-joy-app`, id `2d68a67b-8187-4e4e-9d36-8dcf8e39cebb`) para trabalhar com clareza quando ele acessa mais de uma loja via `user_acessos`.

## Cenários

### 1. Filtro/tabs por loja no topo do Messenger
- Ler `user_acessos` do usuário logado → lista de lojas permitidas + opção **"Todas"**.
- Barra de chips persistente no topo do feed de demandas e da fila de OS a confirmar:
  - 1 loja → esconde a barra (sem ruído).
  - 2+ lojas → chips clicáveis (Todas · Diniz Carapicuíba · Diniz Osasco · …).
  - Estado salvo em `localStorage` (`messenger:filtro_loja`).
- Aplica o filtro nas queries de:
  - `demandas_loja` (por `loja_nome`).
  - `os_recebimento_loja` (por `loja_nome`, pendentes de confirmação).
  - Aba histórico.

### 2. Badges de contagem por loja no menu lateral
- Cada loja no menu lateral ganha dois contadores pequenos:
  - **Demandas não vistas** — `demandas_loja` com `vista_pelo_loja=false` e `status != encerrada`.
  - **OS a confirmar** — `os_recebimento_loja` com `confirmado_at IS NULL`.
- Item **"Todas"** mostra a soma.
- Realtime: **um único** channel Supabase por sessão, com filtro server-side `loja_nome=in.(...)`, atualizando badges sem refresh.
- Bolinha "novo" sutil quando entra item enquanto a aba já está aberta.

### 3. Selector de loja ao abrir demanda nova pelo Messenger
- No dialog "Nova demanda / Nova solicitação":
  - 1 loja → carimba automaticamente (comportamento atual).
  - 2+ lojas → `<Select>` obrigatório **"Falando em nome da loja"** no topo, pré-selecionado com o filtro ativo do cenário 1 pra reduzir cliques.
  - A escolha vai para `loja_nome` / `loja_telefone` da demanda ou solicitação, garantindo que a resposta do setor volte carimbada.
- Mesma regra na tela **"Confirmar OS Recebida"**: a loja escolhida no selector valida que a OS consultada pertence a ela.

## Detalhes técnicos
- **Hook único** `useLojasDoUsuario()` lendo `user_acessos` (ativo=true), reutilizado nos 3 cenários.
- **Contexto** `FiltroLojaProvider` no root do Messenger: `{ lojaSelecionada, setLojaSelecionada, lojasDoUsuario }`.
- Queries passam a usar `.in("loja_nome", lojas)` para "Todas" e `.eq(...)` para específica.
- **RLS já cobre a segurança** (`user_acessos`); o filtro é UX — o `<Select>` só oferece lojas às quais o usuário tem acesso.
- Trabalho é 100% no projeto **InFoco Messenger**; nada muda no Atrium (nem tabelas, nem EFs, nem RLS).

## Fora do escopo
- Backfill de histórico (`loja_nome` já é gravado).
- Notificações push segmentadas por loja (fica para depois se pedido).
- Mudanças no lado do setor recebendo (segue vendo tudo).
