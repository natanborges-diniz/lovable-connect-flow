-- 1. INSERT policy para notificacoes (authenticated)
CREATE POLICY "Authenticated can create notifications"
ON public.notificacoes FOR INSERT TO authenticated
WITH CHECK (usuario_id IS NOT NULL OR setor_id IS NOT NULL);

-- 2. Coluna reentrada_revisao no setor Financeiro
-- Sem ela, o trigger trg_demanda_resposta_reentrada não consegue reabrir cards devolvidos.
INSERT INTO public.pipeline_colunas (setor_id, nome, tipo_acao, ordem, ativo, cor)
SELECT s.id, 'Revisão Pós-Loja', 'reentrada_revisao', 19, true, '#fbbf24'
FROM public.setores s
WHERE s.nome ILIKE '%financeiro%'
  AND NOT EXISTS (
    SELECT 1 FROM public.pipeline_colunas pc
    WHERE pc.setor_id = s.id AND pc.tipo_acao = 'reentrada_revisao'
  )
LIMIT 1;