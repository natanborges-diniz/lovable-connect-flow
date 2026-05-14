# Retomar atendimento da Magali Bueno com receita transcrita

## Contexto verificado

- Atendimento `0fbdc84c-7b9d-47ee-a53f-a25593d19d9c`, contato `5817e8e9…`, telefone `5511967653099`.
- Estado atual: `modo=humano`, `status=aguardando`, **sem receita salva** em `contatos.metadata.receitas` (foto ficou ilegível).
- Última msg da IA já encerrou pedindo equipe; cliente respondeu "Pode deixar então, obrigada".

## Ações (one-shot, sem alterar código)

### 1. Persistir a receita lida manualmente

`update contatos set metadata = jsonb_set(coalesce(metadata,'{}'::jsonb), '{receitas}', '[{...}]'::jsonb, true)` adicionando uma entrada:

```json
{
  "id": "<uuid novo>",
  "tipo": "progressiva",
  "fonte": "humano_transcricao",
  "criado_em": "<now>",
  "od": { "esf":  1.75, "cil": -0.75, "eixo": 95,  "add": 2.75 },
  "oe": { "esf":  1.25, "cil": -0.50, "eixo": 115, "add": 2.75 },
  "observacao": "Transcrita manualmente pelo operador a partir da foto"
}
```

(Adição única +2,75 aplicada nos dois olhos — padrão de receita progressiva.)

### 2. Voltar atendimento para IA

`update atendimentos set modo='ia', status='aguardando', updated_at=now() where id='0fbdc84c…';`

Registrar `eventos_crm` tipo `humano_devolveu_para_ia` com descrição "Receita transcrita manualmente — IA reassume".

### 3. Mensagem proativa ao cliente (via `send-whatsapp`)

Texto a enviar (curto, valida a leitura antes de orçar):

```
Magali, a equipe conseguiu ler sua receita 🙌 Confere se tá certinho:

📋 *Longe / Progressiva*
• *OD:* +1,75 esf | -0,75 cil | eixo 95
• *OE:* +1,25 esf | -0,50 cil | eixo 115
• *Adição:* +2,75

Tá correto? Se sim, já te mostro 3 opções de lentes (econômica, intermediária e premium) 😉
```

Quando ela confirmar (sim/correto/ok), o `ai-triage` segue o fluxo normal de orçamento usando a receita salva (`consultar_lentes_estimativa` ou `consultar_lentes`), porque agora há receita válida em `contatos.metadata.receitas`.

## Não muda

- Código das edge functions (sem deploy).
- Outros atendimentos / pipeline / configurações.
- Nada da loja / Atrium.

Confirma que executo as 3 ações?
