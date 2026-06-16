## Diagnóstico — Card SOL-2026-00062 (DINIZ CARAPICUIBA, Confirmação de PIX)

Reproduzi o estado do card no banco e isolei **três falhas independentes** no caminho Messenger → `criar-solicitacao-loja` → `ConfirmarPixDialog`:

### 1. Imagem do comprovante não carrega (storage órfão)
- `solicitacao_anexos` tem 1 linha apontando para `whatsapp-media/comprovantes/2026/SOL-2026-00062/anexo_1.png`.
- O objeto **não existe** no bucket (HTTP 400 ao abrir; `storage.objects` confirma 0 arquivos para esse protocolo).
- Causa: em `supabase/functions/criar-solicitacao-loja/index.ts` o upload é feito sem checar `error`:
  ```ts
  await supabase.storage.from("whatsapp-media").upload(path, bytes, { contentType: mime, upsert: true });
  ```
  Quando o upload falha silenciosamente (rede, mime desconhecido → `ext=bin`, permissão), o código **ainda assim insere** a linha em `solicitacao_anexos` com a URL pública sintetizada, apontando para um arquivo inexistente. SOL-2026-00045 (BARUERI) também caiu nesse buraco.
- Bônus: quando `fetch(a.url)` retorna `!ok`, o código faz `continue` e perde o anexo silenciosamente em vez de gravar uma referência ao URL original do Messenger (que é público em `mensagens-anexos`).

### 2. Informações da demanda não aparecem (dados vazios)
- `descricao=''` e `metadata` só contém `alias_loja / cod_empresa / origem_app`. Comparativo:
  - SOL-2026-00019 / 00026 (mai 8–11): traziam `valor`, `data_hora`, `nome_cliente`.
  - SOL-2026-00045 / 00062 (mai 21 e jun 13): vieram vazios.
- Causa: o Messenger passou a enviar os campos com prefixo `_` (ou simplesmente parou de enviar), e a EF filtra `!k.startsWith("_")` ao montar a descrição — sobrando string vazia.

### 3. O dialog ignora campos que existem
- `ConfirmarPixDialog` só lê `meta.cliente` e `meta.valor`. Quando o Messenger envia `nome_cliente` / `data_hora`, **nada** aparece na UI. Não há fallback para imagem quebrada nem para metadata vazia.

---

## O que vou implementar

### A. `supabase/functions/criar-solicitacao-loja/index.ts` — anexos resilientes
1. Capturar `{ error }` do `storage.upload`. Em caso de erro: **não inserir caminho fantasma**; gravar `storage_path=null` e `url_publica=a.url` (URL pública original do Messenger), com `metadata.upload_falhou=true` + log claro.
2. Quando `fetch(a.url)` for `!ok`, gravar a linha mesmo assim com `url_publica=a.url` (perder o link é pior que perder a cópia local).
3. Preservar TODAS as chaves de `dados` em `metadata` (inclusive as `_prefixadas`) e também montar `descricao` sem o filtro `_`, exceto para chaves reservadas internas (lista whitelist explícita: `comprovantes`, `lojas_map`, `loja_selecionada_*`).

### B. `src/components/financeiro/ConfirmarPixDialog.tsx` — UI defensiva
1. Renderizar dinamicamente todos os campos relevantes do metadata: `nome_cliente || cliente`, `valor`, `data_hora`, `cpf`, `descricao_pix` etc., com bloco "Detalhes enviados pela loja" que itera o metadata (excluindo chaves de controle: `alias_loja`, `cod_empresa`, `origem_app`, `pix_*_at`, `cancelado_*`).
2. Fallback de imagem: `<img onError>` troca por placeholder com mensagem "Imagem indisponível no storage" + link "Abrir URL original".
3. Fallback de metadata vazio: banner "Loja não enviou detalhes adicionais — solicite reenvio pelo Messenger".

### C. Recuperação cirúrgica do SOL-2026-00062 (best-effort)
Buscar em `mensagens_internas` / `demanda_mensagens` mensagens da DINIZ CARAPICUIBA com anexo de imagem próximas a `2026-06-13 12:47:55` (±15min). Se achar, faço UPDATE em `solicitacao_anexos` apontando `url_publica` para o anexo do Messenger (que está no bucket público `mensagens-anexos`). Se não achar, o card mostra o fallback "imagem indisponível" e o operador pede reenvio.

### Fora de escopo (separado se quiser)
- O **Messenger app** (projeto Infoco, fora deste repo) provavelmente precisa também: parar de prefixar `_` os campos do PIX e voltar a enviar `valor/nome_cliente/data_hora`. Posso te ajudar a abrir um ticket lá, mas a correção real é naquele projeto. As mudanças A+B já fazem o lado Atrium ser tolerante mesmo enquanto o Messenger não muda.

---

## Arquivos tocados
- `supabase/functions/criar-solicitacao-loja/index.ts` (anexos + dados)
- `src/components/financeiro/ConfirmarPixDialog.tsx` (UI defensiva)
- Migração SQL pontual para relinkar SOL-2026-00062 (se achar o anexo no Messenger)

Quer que eu prossiga com os três itens (A + B + C) ou prefere fatiar?
