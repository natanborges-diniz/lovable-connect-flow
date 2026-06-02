## Diagnóstico

O trigger de banco está ativo e disparando, mas **nenhuma notificação é inserida** — logo o `send-push` nunca é chamado.

A função `resolver_destinatarios_atendimento(id)` segue esta lógica:
1. Se o atendimento tem `atendente_user_id` → notifica esse usuário.
2. Senão → busca `setor_id` da `pipeline_colunas` ligada ao contato e notifica todos os `profiles` daquele setor.

Verificado no banco real:
- Os 5 atendimentos abertos em `modo='humano'` têm `atendente_user_id = NULL` (auto-claim do frontend não está marcando).
- As colunas do pipeline humano (`Novo Contato`, `Atendimento Humano`, `Retorno`, etc.) têm todas `setor_id = NULL`.
- Os operadores reais (admin/colaborador como Clemerson, Natan, Fran, ops@teste) **não têm setor_id** em `profiles` nem entrada em `user_roles` com setor.

Resultado: a função retorna `{}` e nenhuma notificação é criada.

## Correção

### 1. Banco — ampliar fallback de `resolver_destinatarios_atendimento`

Acrescentar um terceiro nível de fallback: quando não há atendente atribuído **e** a coluna do contato não tem setor (ou o setor não tem profiles ativos), notificar todos os perfis ativos com `tipo_usuario IN ('admin','colaborador')` — esses são os operadores corporativos de atendimento humano.

Ordem final:
```
1. atendente_user_id (se setado)
2. profiles ativos do setor_id da coluna do contato
3. profiles ativos com tipo_usuario IN ('admin','colaborador')
```

### 2. Frontend — garantir que o auto-claim funciona

Revisar `useClaimAtendimento` em `src/hooks/useAtendimentos.ts` e o ponto de chamada em `src/pages/Atendimentos.tsx` (abertura do drawer). Adicionar `console.log` no sucesso/erro para confirmar que o `UPDATE atendimentos SET atendente_user_id` está rodando quando o operador abre um atendimento em modo humano. Conferir que a RLS de UPDATE permite o claim (a policy adicionada na migration de ontem).

Se descobrirmos que o claim está bloqueado por RLS, ajustar a policy.

### 3. Validação

- Após o deploy, executar manualmente:
  ```sql
  SELECT public.resolver_destinatarios_atendimento('e06c024c-c9bb-4ba0-8875-7e0b47ce355b');
  ```
  para confirmar que retorna usuários.
- Forçar um inbound de teste no atendimento e verificar:
  - linha em `public.notificacoes` (tipo `atendimento_inbound`);
  - log da Edge Function `send-push` (`sent>0`).
- Abrir o drawer com a Fran logada e confirmar que `atendimentos.atendente_user_id` passa a ser o user dela.

## Escopo fora desta correção

Não vou criar setores novos nem reorganizar os profiles — apenas o fallback "admin/colaborador" para destravar push agora. Se depois quisermos restringir a um grupo menor (ex.: só "operadores de atendimento"), criamos uma flag explícita.
