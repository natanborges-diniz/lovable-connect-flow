## Diagnóstico: por que o operador não consegue responder à Carolina

### Causa raiz
O IA escalou **fora do expediente** (sábado 17:43, próxima abertura segunda 09:00 → ~40h depois). Quando o operador abre o atendimento na segunda, a Meta já passou da **janela de 24h** desde o último inbound do cliente. O `send-whatsapp` (linhas 71-93) retorna `422 outside_24h_window` e o composer de texto livre falha. O cliente só pode ser reaberto via **template aprovado** (`send-whatsapp-template`). O dialog `JanelaFechadaDialog` já existe, mas o operador precisa enviar e o cliente responder antes de continuar — passo nada óbvio na UI atual.

Evidência no banco (`eventos_crm.tipo='escalada_fora_horario'`):
- Carolina (`1b53d0c8`, 20/06 20:43): `modo=humano`, `status=aguardando` — janela fechou em 21/06 20:43.
- Priscilla (`0d9919b8`, 22/06 21:12): idem — janela fechou em 23/06 21:12 (já fechada ao abrir hoje).
- Vários outros: `modo=ia` órfãos, alguns nunca migrados para humano.

Problemas secundários confirmados no código:
1. **`ai-triage` linha 8294-8312** (override escalada fora-horário) **NÃO faz `update modo='humano'`** — cards ficam em `modo='ia'` com IA "escalada" só na mensagem. Auto-claim do operador depende dele responder; se ninguém clica, o card fica órfão.
2. Sem alerta proativo: o operador só descobre a janela fechada quando clica Enviar e vê o erro.
3. Sem reabertura programada: a IA promete "segunda 09:00" mas nada agenda o template `retomada_consultor_pos_janela` para sair às 09:00 — fica nas costas do operador descobrir caso a caso.

### Plano (cirúrgico, sem mexer no que funciona)

**A. `supabase/functions/ai-triage/index.ts` — flip modo na escalada fora-horário**
- Dentro do bloco de override (8297-8312), adicionar `update atendimentos.modo='humano'` + mover card para coluna `Humano` (mesmo padrão da escalada normal).
- Calcular `proximaAberturaHumana()` em horas; se > 23h (ou seja, vai estourar a janela 24h), gravar `atendimento.metadata.reabertura_template_at = proximaAberturaHumana()` para a régua agendar template.

**B. Novo cron/handler `cron-reabertura-pos-escalada-fora-horario`** (ou aproveitar `vendas-recuperacao-cron` que já varre atendimentos)
- A cada 10min, busca atendimentos com `metadata.reabertura_template_at <= now()` e janela 24h fechada → dispara `send-whatsapp-template` com `retomada_consultor_pos_janela` (já no catálogo `whatsapp_templates`).
- Marca `metadata.reabertura_template_enviada_at`; idempotente.

**C. Frontend `src/pages/Atendimentos.tsx` — alerta proativo**
- Quando abre um atendimento com último inbound > 23h, mostrar banner amarelo acima do composer: "Janela 24h fechada — reabrir via template" + botão direto que abre `JanelaFechadaDialog` (já existe). Não esperar o erro do Enviar.
- Lookup: `mensagens` última `direcao='inbound'` → diff em horas.

**D. Memória**
- Atualizar `.lovable/memory/atendimento/horario-comercial-humano.md`: documentar que escalada fora-horário SEMPRE flipa `modo=humano` e agenda reabertura por template quando >24h.

### Validação
1. Reabrir o atendimento da Priscilla (`0d9919b8`) na UI → banner amarelo aparece, botão "Reabrir via template" dispara `retomada_consultor_pos_janela`.
2. Simular escalada fora-horário em ambiente: criar atendimento, mockar `isHorarioHumano()=false`, rodar `ai-triage` → confirmar `modo='humano'` + `metadata.reabertura_template_at` populado.
3. Rodar cron manualmente avançando relógio → template sai uma única vez, cliente responde, janela reabre, operador envia texto livre normalmente.

### Arquivos previstos
- `supabase/functions/ai-triage/index.ts` (bloco 8294-8312)
- `supabase/functions/vendas-recuperacao-cron/index.ts` (adicionar branch) **ou** novo `supabase/functions/cron-reabertura-fora-horario/index.ts` + cron 10min
- `src/pages/Atendimentos.tsx` (banner janela fechada)
- `.lovable/memory/atendimento/horario-comercial-humano.md`

### Fora de escopo
- Não muda mensagem ao cliente, branding ou tom — apenas backstage + UX do operador.
- Não toca em `send-whatsapp` nem no roteador OS/cashback já liberados.
