ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_profiles_push_token
  ON public.profiles ((metadata->>'push_token'))
  WHERE metadata ? 'push_token';