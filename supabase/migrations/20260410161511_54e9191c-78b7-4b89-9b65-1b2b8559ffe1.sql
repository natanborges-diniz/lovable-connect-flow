
CREATE OR REPLACE FUNCTION public.nextval_protocolo()
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT nextval('protocolo_interno_seq');
$$;
