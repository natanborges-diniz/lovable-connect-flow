
-- Ativa a coluna "Boleto Enviado" (estava inativa) e marca como NÃO terminal
-- (auto-arquivamento controlado por entrou_terminal_em em metadata após janela)
UPDATE public.pipeline_colunas
   SET ativo = true,
       terminal = false,
       dias_auto_arquivar = 7
 WHERE id = '76cb8433-f00a-490e-9082-7e0ae3c1bc63';

-- Cria a coluna "Boleto em Revisão" no setor Financeiro
INSERT INTO public.pipeline_colunas (setor_id, nome, ordem, ativo, terminal, tipo_acao, cor)
SELECT s.id, 'Boleto em Revisão', 6, true, false, 'revisao_boleto', '#f59e0b'
  FROM public.setores s
 WHERE s.nome ILIKE 'Financeiro'
   AND NOT EXISTS (
     SELECT 1 FROM public.pipeline_colunas pc
      WHERE pc.setor_id = s.id AND pc.nome = 'Boleto em Revisão'
   )
 LIMIT 1;

-- Config global do limite de ciclos
INSERT INTO public.app_config (key, value, updated_at)
VALUES ('boleto_max_ciclos_revisao', '3', now())
ON CONFLICT (key) DO NOTHING;
