-- Add prohibitive rule and example to teach AI not to dump raw URLs in appointment confirmations
INSERT INTO public.ia_regras_proibidas (categoria, regra, ativo) VALUES
('formato', 'NUNCA inclua URLs cruas (https://...) ou links de "perfil da loja" no texto da confirmação de agendamento. O sistema anexa automaticamente um bloco padronizado com endereço da loja após a sua mensagem. Apenas confirme com naturalidade que o agendamento está marcado e ofereça o próximo passo (ex: separar opções de lentes). Se o cliente pedir o link, então sim envie.', true);

INSERT INTO public.ia_exemplos (categoria, pergunta, resposta_ideal, ativo) VALUES
('agendamento', 'pode ser dia 22/04 às 15h', 'Combinado! Já deixei seu horário reservado. Quer que eu separe algumas opções de lentes com a sua receita pra agilizar na hora?', true);

-- Force prompt recompilation
UPDATE public.configuracoes_ia SET valor = '' WHERE chave = 'prompt_compilado';