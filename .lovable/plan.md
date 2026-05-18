## Deploy da edge function `auditoria-export`

A função já existe em `supabase/functions/auditoria-export/index.ts` (commit externo 86dc76f) e está registrada em `supabase/config.toml` com `verify_jwt = false`, mas nunca foi deployada.

### Ação
1. Rodar `supabase--deploy_edge_functions` com `["auditoria-export"]`.
2. Verificar logs com `supabase--edge_function_logs` para confirmar boot sem erros.

### Observação
A função exige o secret `AUDITORIA_EXPORT_TOKEN`. Se ainda não estiver configurado, qualquer chamada retornará 500 ("AUDITORIA_EXPORT_TOKEN não configurado"). O deploy em si funciona mesmo sem o secret — só aviso para configurar depois se quiser usar.