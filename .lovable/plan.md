## Contexto

Cliente **Luzinete Oliveira** (`c41f3607-d92e-4a81-8b3f-f0e278eaea34`, tel `5511953720093`) está em atendimento `86b71001…` modo `humano/aguardando`. Operador transcreveu a receita da foto manualmente. Receita NÃO existe ainda em `contatos.metadata.receitas`.

Receita interpretada como **bifocal/multifocal** (tem grau de longe e perto distintos). Os "eixos" enviados (29/30/27/28) parecem DNP (distância naso-pupilar), não eixo de astigmatismo — não há cilindro. Vou salvar como **multifocal** com `add` calculada (perto − longe = +2,25) e registrar os "eixos" como `dnp` em observação para o consultor revisar.

## Ações (3 passos)

### 1. Persistir receita em `contatos.metadata.receitas`

`jsonb_set` no contato `c41f3607…` adicionando entry:
```
{
  rx_type: 'progressive',
  eyes: {
    od: { sphere: 0.25, cylinder: null, axis: null, add: 2.25 },
    oe: { sphere: 0.25, cylinder: null, axis: null, add: 2.25 }
  },
  confidence: 1.0,
  label: 'Receita transcrita pelo operador',
  source: 'humano_transcricao',
  data_leitura: now(),
  confirmed_by_client_at: null,
  observacao: 'Transcrita a partir da foto. Valores DNP recebidos: OD longe 29 / perto 27, OE longe 30 / perto 28 (não confundir com eixo de astigmatismo).'
}
```

### 2. Devolver atendimento à IA

`UPDATE atendimentos SET modo='ia', status='aguardando', updated_at=now() WHERE id='86b71001…'` + INSERT em `eventos_crm` (`tipo='humano_devolveu_para_ia'`).

### 3. Enviar WhatsApp pedindo confirmação

Chamar `send-whatsapp` (atendimento_id, telefone, remetente_nome='Assistente IA') com mensagem:

> Oi Luzinete! Consegui transcrever a receita aqui pelos dados que você me passou 😊
>
> *Para longe:*
> • OD: +0,25 esf
> • OE: +0,25 esf
>
> *Para perto (adição +2,25):*
> • OD: +2,50 esf
> • OE: +2,50 esf
>
> Tipo: *multifocal/progressiva*
>
> Os valores estão certinhos? Confirma pra eu já te mostrar as opções de lente compatíveis com sua armação 🙌

Após confirmação da cliente, IA segue fluxo padrão (`consultar_lentes` multifocal só-lente).

## Observação

Não há código a alterar — operação puramente de dados + chamada de Edge Function existente.
