UPDATE public.bot_fluxos
SET ativo = true, updated_at = now()
WHERE chave IN ('link_pagamento', 'gerar_boleto', 'consulta_cpf')
  AND tipo_bot = 'loja';