## Deploy ai-triage e verificar boot

1. Chamar `supabase--deploy_edge_functions` com `["ai-triage"]`.
2. Aguardar e chamar `supabase--edge_function_logs` para `ai-triage` filtrando `boot`.
3. Confirmar que o timestamp do evento `Boot` mais recente é posterior às 22:31Z de hoje (epoch ms > 1778891460000).
4. Reportar versão ativa e horário do boot ao usuário. Se boot anterior ao corte, redeployar uma segunda vez.

Sem alterações de código — apenas deploy + verificação de logs.