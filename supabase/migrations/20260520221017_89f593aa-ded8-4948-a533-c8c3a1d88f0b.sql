INSERT INTO public.template_aliases (alias, template_nome)
VALUES ('lembrete_visita', 'lembrete_agendamento')
ON CONFLICT (alias) DO UPDATE SET template_nome = EXCLUDED.template_nome;