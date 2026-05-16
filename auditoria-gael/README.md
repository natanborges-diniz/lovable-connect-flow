# auditoria-gael

Scripts internos para extração e análise de dados do agente **Gael** (Óticas Diniz).  
Esta pasta é de uso exclusivo da equipe de auditoria — não faz parte do produto.

---

## ⚠️ Aviso de segurança

> **NUNCA** commite o arquivo `.env` nem os arquivos em `output/*.json` / `output/*.csv`.  
> Ambos podem conter a **service_role key** e dados pessoais de clientes (PII).  
> Verifique sempre com `git status` antes de fazer commit.

---

## Estrutura

```
auditoria-gael/
├── scripts/
│   └── 01-extracao.ts   # Script principal de extração
├── output/              # Resultados (ignorado pelo git, exceto .gitkeep)
│   └── .gitkeep
├── .env.example         # Modelo de variáveis — copie para .env e preencha
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

---

## Como configurar

1. **Copie o arquivo de exemplo:**
   ```bash
   cp .env.example .env
   ```

2. **Preencha as variáveis no `.env`:**

   | Variável | Onde encontrar |
   |---|---|
   | `SUPABASE_URL` | Supabase Dashboard → Project Settings → API → Project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Project Settings → API → service_role (secret) |
   | `DATABASE_URL` | Supabase Dashboard → Project Settings → Database → Connection string (URI) |

   > A **service_role key** bypassa toda a Row Level Security (RLS).  
   > Trate-a como senha root do banco — não compartilhe nem exponha em logs.

---

## Como rodar

```bash
# Dentro da pasta auditoria-gael/
npm install
npm run extract
```

Os resultados são salvos em `output/`:

| Arquivo | Conteúdo |
|---|---|
| `01-amostra-conversas.json` | 30 conversas estratificadas por fluxo e qualidade (anonimizadas) |
| `02-auditorias.json` | Últimas 100 auditorias do `audit-ia-rodar` |
| `03-metricas.json` | Métricas operacionais dos últimos 30 dias |
| `04-system-prompt.json` | Prompt(s) vigentes na tabela `configuracoes_ia` |

---

## Dados sensíveis — checklist antes de cada sessão

- [ ] `.env` existe localmente e **não** está no `git status`
- [ ] `output/*.json` **não** aparecem no `git status`
- [ ] A service_role key **não** aparece em nenhum log ou output
- [ ] Após a análise, os JSONs de output foram deletados ou armazenados em local seguro
