# Fila humana não recebe cards escalados a partir de modo=ponte

## Diagnóstico (confirmado no banco)

Caso Cairo (contato `ea2c593f…`, atendimento `5d6ccfa5…`):
- Cliente digitou **"Quero falar com atendente"** às 14:40:08.
- Atendimento está em `modo = 'ponte'`, sem `atendente_user_id`, sem `atendente_nome`.
- A fila humana em `src/pages/Pipeline.tsx` (linha 397) filtra por `at?.modo === "humano"` → card não aparece.

Causa raiz em `supabase/functions/ai-triage/index.ts`:

```text
linha 3285: if (atendimento.modo === "ponte") { return skipped; }
linha 3405: if (matchesEscalation(currentMsg)) { handleEscalation(...) }
```

O router de escalada (`matchesEscalation` → `handleEscalation`, que faz `UPDATE modo='humano'`) fica **depois** do skip de ponte. Toda mensagem em modo ponte é descartada antes de checar palavras-chave de escalada. Resultado: `modo` permanece `ponte` para sempre.

## Correção

Adicionar um **pre-router de escalada** logo antes dos skips de `humano`/`ponte` em `ai-triage/index.ts` (por volta da linha 3141, antes do bloco "PRE-ROUTER: Retomar IA quando cliente digita receita após escalada"):

```ts
{
  const _msgEsc = String(mensagem_texto || "").trim();
  if (_msgEsc
      && (atendimento.modo === "ponte" || atendimento.modo === "hibrido")
      && matchesEscalation(_msgEsc)) {
    const { data: _ct } = await supabase
      .from("contatos").select("nome")
      .eq("id", contato_id || atendimento.contato_id).maybeSingle();
    const _prim = (_ct?.nome || "").trim().split(/\s+/)[0] || "";
    return await handleEscalation(
      supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
      atendimento_id, contato_id || atendimento.contato_id,
      _msgEsc, "keyword_pre_ponte", _prim,
    );
  }
}
```

`handleEscalation` já:
- envia mensagem canônica ao cliente (ou aviso fora do expediente),
- faz `UPDATE atendimentos SET modo='humano'`,
- dispara `summarize-atendimento`,
- registra `eventos_crm.tipo='escalonamento_humano'`.

Com isso, o card entra imediatamente na "Fila de Atendimento Humano" do CRM.

## Saneamento do caso Cairo

Rodar 1x manualmente:

```sql
UPDATE atendimentos SET modo='humano'
 WHERE id='5d6ccfa5-8e68-4cfd-b34e-4ee18b4e75f6';
```

Não é preciso reenviar mensagem — o cliente já recebeu "Vou te conectar com um Consultor…" às 14:42.

## Fora de escopo (mantido igual)

- Não altero o filtro do `Pipeline.tsx` — a fila é `modo=humano` por design (ponte = operador atende via app externo, não deve poluir a fila).
- Não altero `handleEscalation`.
- Não mexo em outros modos (`ia` continua caindo no router original da linha 3405; `humano` continua no bloco de retomada por receita).
