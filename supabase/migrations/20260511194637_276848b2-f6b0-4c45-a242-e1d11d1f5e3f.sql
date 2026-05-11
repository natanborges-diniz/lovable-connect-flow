
-- 1. Nova coluna "Consulta de OS" no setor Atendimento Corporativo
INSERT INTO public.pipeline_colunas (nome, setor_id, ordem, cor, ativo, grupo_funil)
SELECT 'Consulta de OS', '32cbd99c-4b20-4c8b-b7b2-901904d0aff6'::uuid,
       COALESCE(MAX(ordem), 0) + 1, 'amber-500', true, 'pos_venda'
FROM public.pipeline_colunas
WHERE setor_id = '32cbd99c-4b20-4c8b-b7b2-901904d0aff6'::uuid
ON CONFLICT DO NOTHING;

-- 2. Keywords editáveis (JSON array de regex/substrings, case-insensitive)
INSERT INTO public.configuracoes_ia (chave, valor)
VALUES (
  'os_intent_keywords',
  '["oculos pronto","óculos pronto","ficou pronto","esta pronto","está pronto","ta pronto","tá pronto","posso retirar","ja chegou","já chegou","chegou meu","quando fica pronto","quando chega","cade meu pedido","cadê meu pedido","cade meu oculos","cadê meu óculos","onde esta meu pedido","onde está meu pedido","status do pedido","status da os","minha os","numero da os","número da os","ordem de servico","ordem de serviço","previsao de entrega","previsão de entrega","pedido ficou pronto","retirar meu oculos","retirar meu óculos"]'
)
ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = now();

-- 3. Mensagem fixa de escalada (editável pela auditoria)
INSERT INTO public.ia_mensagens_fixas (chave, texto, descricao, variaveis, ativo)
VALUES (
  'os_escalada',
  'Claro{nome_comma}! Pra consultar o status do seu pedido vou te passar pra um atendente da loja agora 🙌 Se você já tiver em mãos, me adianta o *número da OS* (vem no comprovante de compra) ou o *nome completo do titular* — já encaminho.',
  'Mensagem enviada ao cliente quando IA detecta consulta de status de OS / óculos pronto, antes da escalada para humano',
  ARRAY['nome_comma'],
  true
)
ON CONFLICT (chave) DO UPDATE SET texto = EXCLUDED.texto, descricao = EXCLUDED.descricao, variaveis = EXCLUDED.variaveis, updated_at = now();

-- 4. 3 exemplos de conversa ensinando o comportamento correto
INSERT INTO public.ia_exemplos (categoria, pergunta, resposta_ideal, ativo) VALUES
  ('consulta_os',
   'meu óculos já está pronto?',
   'Claro! Pra consultar o status do seu pedido vou te passar pra um atendente da loja agora 🙌 Se você já tiver em mãos, me adianta o número da OS (vem no comprovante) ou o nome completo do titular — já encaminho.',
   true),
  ('consulta_os',
   'quando posso retirar meu pedido? a OS é 45123',
   'Perfeito, anotei a OS 45123. Vou te passar pra um atendente da loja agora pra te confirmar o status e a previsão de retirada 🙌',
   true),
  ('consulta_os',
   'cadê meu óculos? faz semanas que comprei',
   'Entendi! Pra te dar uma resposta precisa, vou te passar pra um atendente da loja agora pra checar o pedido no sistema 🙌 Se tiver o número da OS ou o nome completo do titular, manda aqui que adianto.',
   true)
ON CONFLICT DO NOTHING;

-- 5. Regra proibida: nunca pedir receita / oferecer orçamento em consulta de OS
INSERT INTO public.ia_regras_proibidas (regra, categoria, ativo) VALUES
  ('Quando o cliente pergunta sobre status do pedido, OS, ou se o óculos está pronto/disponível para retirada — JAMAIS peça receita, foto da receita, grau, ADD ou CIL. JAMAIS ofereça orçamento, preço ou opções de lentes. Sempre escale imediatamente para um atendente humano da loja.',
   'comportamento',
   true)
ON CONFLICT DO NOTHING;
