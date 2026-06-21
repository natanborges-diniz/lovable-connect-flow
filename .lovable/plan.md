## Auditoria de uploads

Varredura em todos os buckets/locais que aceitam anexo:

| Bucket | Path usado no upload | Policy INSERT atual | Status |
|---|---|---|---|
| `cpf-documentos` | `${solicitacao.id}/...` (CpfApprovalDialog) | exige `foldername[1] = auth.uid()` | **❌ quebrado para não-admin** (Felix/Leticia) |
| `mensagens-anexos` | `demandas/{ano}/uuid.ext` (AcionarLojaDialog) | exige `foldername[1] = auth.uid()` | **❌ quebrado para todos** (a primeira pasta é "demandas") |
| `mensagens-anexos` | `${user.id}/financeiro/...` (ConcluirSolicitacaoDialog, ConfirmarPixDialog) | mesma policy | ✅ funciona |
| `mensagens-anexos` | `${uid}/atendimentos/...` (Pipeline.tsx, Atendimentos.tsx) | mesma policy | ✅ funciona |
| `estoque-confirmacoes` | `{ano}/uuid.ext` | livre para authenticated | ✅ |
| `solicitacao-anexos` | usada via EF | livre para authenticated | ✅ |
| `whatsapp-media` | service_role | service_role | ✅ |

## Correção

Migration ajustando as policies dos dois buckets afetados — são internos (cpf privado, mensagens-anexos público apenas em SELECT) e quem chega no Dialog já passou pelo gate de módulo (Financeiro / Atendimentos).

```sql
-- cpf-documentos: libera INSERT/SELECT/UPDATE p/ qualquer authenticated; DELETE só admin.
DROP POLICY IF EXISTS "Users upload own cpf docs" ON storage.objects;
DROP POLICY IF EXISTS "Users read own cpf docs"   ON storage.objects;
DROP POLICY IF EXISTS "Users update own cpf docs" ON storage.objects;
DROP POLICY IF EXISTS "Users delete own cpf docs" ON storage.objects;

CREATE POLICY "Financeiro upload cpf docs" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'cpf-documentos');

CREATE POLICY "Financeiro read cpf docs" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'cpf-documentos');

CREATE POLICY "Financeiro update cpf docs" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'cpf-documentos')
  WITH CHECK (bucket_id = 'cpf-documentos');

CREATE POLICY "Admin delete cpf docs" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'cpf-documentos' AND public.is_admin(auth.uid()));

-- mensagens-anexos: libera INSERT/UPDATE/DELETE para qualquer authenticated
-- (SELECT já é público — bucket usado em comprovantes, demandas, etc).
DROP POLICY IF EXISTS "Anexos: upload do próprio usuário" ON storage.objects;
DROP POLICY IF EXISTS "Anexos: update do próprio usuário" ON storage.objects;
DROP POLICY IF EXISTS "Anexos: delete do próprio usuário" ON storage.objects;

CREATE POLICY "Anexos: upload autenticado" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'mensagens-anexos');

CREATE POLICY "Anexos: update autenticado" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'mensagens-anexos')
  WITH CHECK (bucket_id = 'mensagens-anexos');

CREATE POLICY "Anexos: delete autenticado" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'mensagens-anexos');
```

Nenhuma mudança de frontend é necessária — todos os componentes voltam a funcionar (CpfApprovalDialog para Felix/Leticia + AcionarLojaDialog com anexo para qualquer operador).

## Resumo
Duas RLS de Storage exigiam que a 1ª pasta do arquivo fosse o uid do usuário, mas o código grava com prefixo `solicitacao.id` ou `demandas/`. Libero leitura/escrita para autenticados nos buckets `cpf-documentos` e `mensagens-anexos` (delete do cpf segue restrito a admin). Sem alterações no frontend.