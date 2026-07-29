ALTER TABLE public.atendimentos DROP CONSTRAINT IF EXISTS atendimentos_modo_check;
ALTER TABLE public.atendimentos ADD CONSTRAINT atendimentos_modo_check CHECK (modo IN ('ia','humano','ponte'));