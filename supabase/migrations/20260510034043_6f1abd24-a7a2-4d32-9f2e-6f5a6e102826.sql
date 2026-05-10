
CREATE TABLE public.ia_mensagens_fixas (
  chave text PRIMARY KEY,
  texto text NOT NULL,
  descricao text,
  variaveis text[] NOT NULL DEFAULT '{}',
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.ia_mensagens_fixas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ia_mensagens_fixas_admin_all"
ON public.ia_mensagens_fixas
FOR ALL
TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "ia_mensagens_fixas_auth_read"
ON public.ia_mensagens_fixas
FOR SELECT
TO authenticated
USING (true);

CREATE TRIGGER trg_ia_mensagens_fixas_updated_at
BEFORE UPDATE ON public.ia_mensagens_fixas
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed com os textos atuais (placeholders entre {chaves})
INSERT INTO public.ia_mensagens_fixas (chave, texto, descricao, variaveis) VALUES
(
  'despedida_explicit_close',
  'Foi um prazer te atender{nome_comma}! 🙏 Obrigado pelo contato{tail}. Qualquer coisa, é só me chamar 👋',
  'Despedida quando cliente encerra explicitamente (ex: "tchau", "obrigado, era só isso"). Disparada de forma determinística (sem LLM).',
  ARRAY['nome_comma','tail']
),
(
  'despedida_thanks',
  'De nada{nome_comma}! {tail} 👋 Qualquer dúvida é só me chamar.',
  'Despedida quando cliente apenas agradece após oferta resolvida. {tail} = "Te espero {agendamentoFmt}" se houver agendamento, senão "Qualquer coisa estou por aqui".',
  ARRAY['nome_comma','tail']
),
(
  'despedida_short_no',
  'Combinado{nome_comma}! {tail} 👋 Qualquer dúvida é só me chamar.',
  'Despedida quando cliente diz "não" curto à oferta de mais ajuda.',
  ARRAY['nome_comma','tail']
),
(
  'escalada_fora_horario',
  'Vou acionar nossa equipe pra você{nome_saud}! 🙌 Só um detalhe: nosso time humano atende de seg a sex das 09h às 18h e sábado das 08h às 12h. Como estamos fora do horário agora, assim que abrir o próximo expediente ({proxima_abertura}), eles te respondem por aqui. Pode deixar registrado o que precisa que já encaminho 😉',
  'Mensagem enviada quando IA escala pra humano FORA do horário comercial (Seg-Sex 09-18 / Sáb 08-12 SP).',
  ARRAY['nome_saud','proxima_abertura']
),
(
  'pedir_receita_texto',
  E'Tô tendo dificuldade de ler os valores na foto 😅 Pode me passar por texto, por favor?\n\nPreciso de:\n• *OD* (olho direito): esférico / cilíndrico / eixo (e adição se tiver)\n• *OE* (olho esquerdo): esférico / cilíndrico / eixo (e adição se tiver)\n\nEx: *OD -2,00 cil -0,75 eixo 180* / *OE -1,75 cil -0,50 eixo 170*\n\nSe preferir, mande outra foto com a receita inteira no enquadramento e boa iluminação 📸',
  'Fallback quando OCR da receita falha. Pede valores por texto.',
  ARRAY[]::text[]
),
(
  'recuperacao_ia_despedida_final',
  'Olá {first_name}! 😊 Agradeço muito o seu contato com as Óticas Diniz. Não quero te incomodar, então vou encerrar nossa conversa por aqui. Qualquer dúvida que surgir — sobre lentes, armações, agendamento ou orçamento — é só me chamar de volta, estou à disposição. Tenha um ótimo dia! ✨',
  'Despedida final enviada por vendas-recuperacao-cron após esgotar tentativas de retomada IA. Antes de mover lead pra Perdidos.',
  ARRAY['first_name']
);
