## Sync + Publish do commit c230a47

1. Rodar SYNC interno para puxar `origin/main` (commit `c230a47`) para a cópia do Lovable
2. Confirmar via `git log -1` que o HEAD interno bateu com `c230a47`
3. Chamar `preview_ui--publish` para deployar (edge functions sobem automaticamente no autodeploy do backend; o publish garante o frontend)
4. Reportar resultado (commit confirmado + URL de publish agendada)

Sem edição de código, sem migration.