
ALTER TABLE public.telefones_lojas
  ADD COLUMN IF NOT EXISTS horarios_semana jsonb NOT NULL DEFAULT jsonb_build_object(
    'seg', jsonb_build_object('abre','09:00','fecha','19:00'),
    'ter', jsonb_build_object('abre','09:00','fecha','19:00'),
    'qua', jsonb_build_object('abre','09:00','fecha','19:00'),
    'qui', jsonb_build_object('abre','09:00','fecha','19:00'),
    'sex', jsonb_build_object('abre','09:00','fecha','19:00'),
    'sab', jsonb_build_object('abre','09:00','fecha','18:00'),
    'dom', 'null'::jsonb
  );

UPDATE public.telefones_lojas SET horarios_semana = jsonb_build_object(
  'seg', jsonb_build_object('abre', COALESCE(horario_abertura,'09:00'), 'fecha', COALESCE(horario_fechamento,'19:00')),
  'ter', jsonb_build_object('abre', COALESCE(horario_abertura,'09:00'), 'fecha', COALESCE(horario_fechamento,'19:00')),
  'qua', jsonb_build_object('abre', COALESCE(horario_abertura,'09:00'), 'fecha', COALESCE(horario_fechamento,'19:00')),
  'qui', jsonb_build_object('abre', COALESCE(horario_abertura,'09:00'), 'fecha', COALESCE(horario_fechamento,'19:00')),
  'sex', jsonb_build_object('abre', COALESCE(horario_abertura,'09:00'), 'fecha', COALESCE(horario_fechamento,'19:00')),
  'sab', jsonb_build_object('abre','09:00','fecha','18:00'),
  'dom', 'null'::jsonb
);

UPDATE public.telefones_lojas
SET horarios_semana = horarios_semana || jsonb_build_object('dom', jsonb_build_object('abre','14:00','fecha','20:00'))
WHERE nome_loja IN ('DINIZ UNIÃO','DINIZ SUPER SHOPPING');

CREATE TABLE IF NOT EXISTS public.feriados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data date NOT NULL,
  nome text NOT NULL,
  tipo text NOT NULL DEFAULT 'nacional' CHECK (tipo IN ('nacional','estadual','municipal','interno')),
  fecha_todas boolean NOT NULL DEFAULT false,
  recorrente boolean NOT NULL DEFAULT true,
  ativo boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (data, nome)
);

ALTER TABLE public.feriados ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated manage feriados" ON public.feriados FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Anon read feriados" ON public.feriados FOR SELECT TO anon USING (true);
CREATE POLICY "Service role full access feriados" ON public.feriados FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_feriados_data ON public.feriados(data) WHERE ativo;

CREATE TABLE IF NOT EXISTS public.loja_feriado_politica (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id uuid NOT NULL REFERENCES public.telefones_lojas(id) ON DELETE CASCADE,
  escopo text NOT NULL CHECK (escopo IN ('default_nacional','feriado_especifico')),
  feriado_id uuid REFERENCES public.feriados(id) ON DELETE CASCADE,
  politica text NOT NULL CHECK (politica IN ('fechada','abre_horario_domingo','abre_horario_normal','abre_horario_customizado')),
  horario_custom jsonb,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (loja_id, escopo, feriado_id)
);

ALTER TABLE public.loja_feriado_politica ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated manage loja_feriado_politica" ON public.loja_feriado_politica FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Anon read loja_feriado_politica" ON public.loja_feriado_politica FOR SELECT TO anon USING (true);
CREATE POLICY "Service role full access loja_feriado_politica" ON public.loja_feriado_politica FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_loja_feriado_politica_loja ON public.loja_feriado_politica(loja_id) WHERE ativo;

CREATE TRIGGER trg_feriados_updated BEFORE UPDATE ON public.feriados
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_loja_feriado_politica_updated BEFORE UPDATE ON public.loja_feriado_politica
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.loja_status_no_dia(_loja_id uuid, _data date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _loja record;
  _feriado record;
  _politica record;
  _dia_chave text;
  _horario jsonb;
BEGIN
  SELECT id, nome_loja, horarios_semana INTO _loja
  FROM public.telefones_lojas WHERE id = _loja_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('aberta', false, 'motivo', 'loja_nao_encontrada');
  END IF;

  SELECT * INTO _feriado FROM public.feriados
  WHERE ativo = true
    AND (
      data = _data
      OR (recorrente AND extract(month FROM data) = extract(month FROM _data)
                     AND extract(day   FROM data) = extract(day   FROM _data))
    )
  ORDER BY (data = _data) DESC, fecha_todas DESC
  LIMIT 1;

  IF FOUND THEN
    IF _feriado.fecha_todas THEN
      RETURN jsonb_build_object('aberta', false, 'motivo', 'feriado_nacional_total', 'feriado_nome', _feriado.nome);
    END IF;

    SELECT * INTO _politica FROM public.loja_feriado_politica
    WHERE ativo AND loja_id = _loja_id
      AND ((escopo = 'feriado_especifico' AND feriado_id = _feriado.id)
        OR (escopo = 'default_nacional'   AND _feriado.tipo = 'nacional'))
    ORDER BY (escopo = 'feriado_especifico') DESC
    LIMIT 1;

    IF FOUND THEN
      IF _politica.politica = 'fechada' THEN
        RETURN jsonb_build_object('aberta', false, 'motivo', 'feriado_loja_fechada', 'feriado_nome', _feriado.nome);
      ELSIF _politica.politica = 'abre_horario_domingo' THEN
        _horario := _loja.horarios_semana->'dom';
        IF _horario IS NULL OR _horario = 'null'::jsonb THEN
          RETURN jsonb_build_object('aberta', false, 'motivo', 'feriado_sem_horario_domingo', 'feriado_nome', _feriado.nome);
        END IF;
        RETURN jsonb_build_object('aberta', true, 'abre', _horario->>'abre', 'fecha', _horario->>'fecha',
                                  'motivo', 'feriado_horario_domingo', 'feriado_nome', _feriado.nome);
      ELSIF _politica.politica = 'abre_horario_customizado' AND _politica.horario_custom IS NOT NULL THEN
        RETURN jsonb_build_object('aberta', true,
                                  'abre',  _politica.horario_custom->>'abre',
                                  'fecha', _politica.horario_custom->>'fecha',
                                  'motivo', 'feriado_horario_customizado', 'feriado_nome', _feriado.nome);
      END IF;
    ELSE
      IF _feriado.tipo = 'nacional' THEN
        RETURN jsonb_build_object('aberta', false, 'motivo', 'feriado_sem_politica', 'feriado_nome', _feriado.nome);
      END IF;
    END IF;
  END IF;

  _dia_chave := CASE extract(dow FROM _data)::int
    WHEN 0 THEN 'dom' WHEN 1 THEN 'seg' WHEN 2 THEN 'ter' WHEN 3 THEN 'qua'
    WHEN 4 THEN 'qui' WHEN 5 THEN 'sex' WHEN 6 THEN 'sab'
  END;

  _horario := _loja.horarios_semana->_dia_chave;
  IF _horario IS NULL OR _horario = 'null'::jsonb THEN
    RETURN jsonb_build_object('aberta', false, 'motivo', 'dia_fechado', 'dia', _dia_chave);
  END IF;

  RETURN jsonb_build_object('aberta', true, 'abre', _horario->>'abre', 'fecha', _horario->>'fecha',
                            'motivo', 'horario_normal', 'dia', _dia_chave);
END;
$$;

INSERT INTO public.feriados (data, nome, tipo, fecha_todas, recorrente) VALUES
  ('2026-01-01','Confraternização Universal','nacional', true,  true),
  ('2026-04-21','Tiradentes',                'nacional', false, true),
  ('2026-05-01','Dia do Trabalho',           'nacional', true,  true),
  ('2026-09-07','Independência',             'nacional', false, true),
  ('2026-10-12','Padroeira',                 'nacional', false, true),
  ('2026-11-02','Finados',                   'nacional', false, true),
  ('2026-11-15','Proclamação da República',  'nacional', false, true),
  ('2026-11-20','Consciência Negra',         'nacional', false, true),
  ('2026-12-25','Natal',                     'nacional', false, true),
  ('2026-02-17','Carnaval',                  'nacional', false, false),
  ('2026-04-03','Sexta-feira Santa',         'nacional', false, false),
  ('2026-06-04','Corpus Christi',            'nacional', false, false)
ON CONFLICT (data, nome) DO NOTHING;

INSERT INTO public.loja_feriado_politica (loja_id, escopo, politica)
SELECT id, 'default_nacional', 'fechada'
FROM public.telefones_lojas
WHERE tipo = 'loja' AND ativo = true
ON CONFLICT (loja_id, escopo, feriado_id) DO NOTHING;

UPDATE public.loja_feriado_politica p
SET politica = 'abre_horario_domingo'
FROM public.telefones_lojas t
WHERE p.loja_id = t.id
  AND p.escopo = 'default_nacional'
  AND t.nome_loja IN ('DINIZ UNIÃO','DINIZ SUPER SHOPPING');
