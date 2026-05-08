## Objetivo

Eliminar o risco de admins criarem grupos avulsos que dupliquem ou colidam com os canais já usados no atendimento humano (setores e lojas). O diálogo "Novo grupo" deixa de pedir uma lista livre de participantes — passa a oferecer **as mesmas opções já existentes no atendimento humano** (setores e lojas), e os membros são recalculados automaticamente quando alguém entra/sai.

## Modelo

```
conversas_grupo
 ├─ tipo_origem: 'setor' | 'loja' | 'custom'
 ├─ origem_ref:  setor_id  | loja_nome | null
 └─ participantes: uuid[]  ← agora derivado, recalculado por trigger/função
```

- **setor**: membros = todos os `profiles` ativos com `setor_id = origem_ref`.
- **loja**: membros = todos os `profiles` ativos cujo `metadata->>'loja_nome' = origem_ref` (mesma chave usada hoje no pipeline da loja).
- **custom**: caminho legado para os grupos que já existem; novos não podem mais ser criados como custom.

Apenas admin cria/edita/apaga (RLS atual mantida).

## Mudanças

### 1. Banco (migration)
- `ALTER TABLE conversas_grupo ADD tipo_origem text NOT NULL DEFAULT 'custom'`, `ADD origem_ref text`.
- Índice único parcial em `(tipo_origem, origem_ref) WHERE tipo_origem <> 'custom'` → impede dois grupos para o mesmo setor/loja.
- Função `sync_grupo_membros(grupo_id)` que repopula `participantes` conforme `tipo_origem`/`origem_ref`.
- Triggers:
  - em `profiles` (INSERT/UPDATE/DELETE de `setor_id`, `ativo`, `metadata.loja_nome`) → ressincroniza grupos afetados.
  - em `conversas_grupo` BEFORE INSERT/UPDATE → se `tipo_origem ≠ 'custom'`, calcula `participantes` automaticamente e força `nome` padrão ("Setor — X" ou "Loja — Y") se vazio.
- Backfill: nada destrutivo. Grupos atuais ficam como `tipo_origem='custom'`.

### 2. Frontend
- `NovoGrupoDialog.tsx` reescrito:
  - Passo 1 (radio): **Setor** • **Loja**.
  - Passo 2: select com a lista de setores ativos OU lojas distintas (mesma fonte que o atendimento humano usa — `setores` ativos / `loja_nome` distintos em `telefones_lojas`).
  - Mostra preview dos membros derivados (somente leitura) e o nome sugerido editável.
  - Bloqueia confirmar se já existir grupo para aquele setor/loja (lê o índice).
  - Remove a busca livre de participantes e o checkbox manual.
- `useCriarGrupo`: passa a enviar `{ tipo_origem, origem_ref, nome }`; backend resolve participantes.
- `useMensagensInternas` / `Mensagens.tsx`: nada muda no consumo (lista, header, broadcast continuam por `grupo_<uuid>`).

### 3. Memória
Atualizar `mem://atendimento/conversas-grupo` para refletir: grupos são derivados de setor/loja, membros auto-sincronizados, criação restrita a admin, sem participantes manuais.

## Fora de escopo
- App InFoco Messenger (mobile só consome).
- Atendimento ao cliente final / WhatsApp Meta — inalterado.
- Grupos custom existentes permanecem funcionando, mas a UI não permite criar novos do tipo custom.
