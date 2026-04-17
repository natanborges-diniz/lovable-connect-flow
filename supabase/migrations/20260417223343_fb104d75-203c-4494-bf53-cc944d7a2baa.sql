-- Tabela de preços de lentes de contato
CREATE TABLE IF NOT EXISTS public.pricing_lentes_contato (
  id BIGSERIAL PRIMARY KEY,
  fornecedor TEXT NOT NULL,
  produto TEXT NOT NULL,
  material TEXT,
  dk NUMERIC,
  sphere_min NUMERIC,
  sphere_max NUMERIC,
  cylinder_min NUMERIC,
  cylinder_max NUMERIC,
  cylinder_axes_disponiveis TEXT,
  descarte TEXT NOT NULL,
  dias_por_unidade INTEGER NOT NULL DEFAULT 30,
  unidades_por_caixa INTEGER NOT NULL DEFAULT 6,
  price_brl NUMERIC NOT NULL,
  is_toric BOOLEAN NOT NULL DEFAULT false,
  is_color BOOLEAN NOT NULL DEFAULT false,
  is_dnz BOOLEAN NOT NULL DEFAULT false,
  priority INTEGER NOT NULL DEFAULT 10,
  combo_3mais1 BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  observacoes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lentes_contato_active ON public.pricing_lentes_contato(active);
CREATE INDEX IF NOT EXISTS idx_lentes_contato_descarte ON public.pricing_lentes_contato(descarte);
CREATE INDEX IF NOT EXISTS idx_lentes_contato_toric ON public.pricing_lentes_contato(is_toric);
CREATE INDEX IF NOT EXISTS idx_lentes_contato_dnz ON public.pricing_lentes_contato(is_dnz);

ALTER TABLE public.pricing_lentes_contato ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anon can read pricing_lentes_contato"
  ON public.pricing_lentes_contato FOR SELECT TO anon USING (true);
CREATE POLICY "Authenticated can read pricing_lentes_contato"
  ON public.pricing_lentes_contato FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can manage pricing_lentes_contato"
  ON public.pricing_lentes_contato FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access pricing_lentes_contato"
  ON public.pricing_lentes_contato FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER trg_pricing_lentes_contato_updated
  BEFORE UPDATE ON public.pricing_lentes_contato
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Adicionar flag nome_confirmado ao metadata default não é necessário (jsonb)
-- Mas vamos garantir que contatos.metadata aceite a flag (já é jsonb default '{}')

-- Inserção dos 51 produtos da planilha de Abril/2026
INSERT INTO public.pricing_lentes_contato (fornecedor, produto, material, dk, sphere_min, sphere_max, cylinder_min, cylinder_max, cylinder_axes_disponiveis, descarte, dias_por_unidade, unidades_por_caixa, price_brl, is_toric, is_color, is_dnz, priority, combo_3mais1, active) VALUES
('Coopervision', 'Biofinity Energys', 'Silícone Hidrogel de 3ª Geração', 128.0, -12.0, 8.0, NULL, NULL, NULL, 'mensal', 30, 6, 310.0, false, false, false, 5, true, true),
('Coopervision', 'Biofinity', 'Silícone Hidrogel de 3ª Geração', 128.0, -12.0, 8.0, NULL, NULL, NULL, 'mensal', 30, 6, 285.0, false, false, false, 5, true, true),
('Coopervision', 'Biofinity XR', 'Silícone Hidrogel de 3ª Geração', 128.0, -20.0, 15.0, NULL, NULL, NULL, 'mensal', 30, 6, 310.0, false, false, false, 5, true, true),
('Coopervision', 'Biofinity Toric', 'Silícone Hidrogel de 3ª Geração', 128.0, -10.0, 8.0, -2.25, -0.75, '-0.75 / -1.25 / -1.75 / -2.25', 'mensal', 30, 6, 390.0, true, false, false, 5, true, true),
('Coopervision', 'Biofinity XR Toric', 'Silícone Hidrogel de 3ª Geração', 128.0, -20.0, 20.0, -5.75, -0.75, '-2.75 / -3.25 / -3.75 / -4.25 / -4.75 / -5.25 / -5.75 / -0.75 / -1.25 / -1.75 / -2.25 (para os graus +8.50 a +20.00 e de -10.50 a -20.00)', 'mensal', 30, 6, 655.0, true, false, false, 5, true, true),
('Coopervision', 'Clariti 1 Day', 'Silícone Hidrogel de 3ª Geração', 60.0, -10.0, 8.0, NULL, NULL, NULL, 'diario', 1, 30, 215.0, false, false, false, 10, false, true),
('Coopervision', 'Clariti 1 Day Toric', 'Silícone Hidrogel de 3ª Geração', 60.0, -6.0, 4.0, -2.25, -0.75, '-0.75 / -1.25 / -1.75 / -2.25', 'diario', 1, 30, 265.0, true, false, false, 10, false, true),
('Coopervision', 'Avaira Vitality', 'Silícone Hidrogel de 3ª Geração', 90.0, -12.0, 8.0, NULL, NULL, NULL, 'diario', 1, 6, 235.0, false, false, false, 10, false, true),
('Coopervision', 'Proclear', 'Hidrogel', 27.0, -12.0, 8.0, NULL, NULL, NULL, 'mensal', 30, 6, 240.0, false, false, false, 10, true, true),
('Coopervision', 'Proclear XR', 'Hidrogel', 27.0, -20.0, 20.0, NULL, NULL, NULL, 'mensal', 30, 6, 245.0, false, false, false, 10, true, true),
('Coopervision', 'Proclear 1 Day', 'Hidrogel', 25.0, -12.0, 8.0, NULL, NULL, NULL, 'diario', 1, 30, 200.0, false, false, false, 10, false, true),
('Coopervision', 'Biomedics 55 Evolution', 'Hidrogel', 19.0, -10.0, 6.0, NULL, NULL, NULL, 'mensal', 30, 6, 220.0, false, false, false, 10, true, true),
('Alcon', 'Air Optix for Astigmatism', 'Lotrafilcon B', 110.0, -6.0, 6.0, -2.25, -0.75, '-0.75 / -1.25 / -1.75 / -2.25', 'mensal', 30, 6, 363.0, true, false, false, 10, true, true),
('Alcon', 'Air Optix Plus Hydraglide', 'Lotrafilcon B', 138.0, -12.0, 8.0, -2.25, -0.75, '-0.75 / -2.25', 'mensal', 30, 6, 290.0, true, false, false, 10, true, true),
('Alcon', 'Air Optix Aqua', 'Lotrafilcon B', 138.0, -6.0, 6.0, NULL, NULL, NULL, 'mensal', 30, 6, 200.0, false, false, false, 10, true, true),
('Alcon', 'Air Optix Night&Day Aqua', 'Lotrafilcon A', 175.0, -8.0, 6.0, NULL, NULL, NULL, 'mensal', 30, 6, 446.0, false, false, false, 10, true, true),
('Alcon', 'Air Optix plus HydraGlyde for Astigmatism', 'Lotrafilcon B', 138.0, -6.0, 0.0, -2.25, -0.75, '-0.75 / -1.25 / -1.75 / -2.25', 'mensal', 30, 6, 425.0, true, false, false, 10, true, true),
('Alcon', 'Dailies AquaComfort Plus', 'Nelfilcon A', 26.0, -6.0, 8.0, NULL, NULL, NULL, 'diario', 1, 10, 320.0, false, false, false, 10, false, true),
('Alcon', 'Dailies AquaComfort Plus Toric', 'Nelfilcon A', 26.0, -6.0, 4.0, -1.75, -0.75, '-0.75 / -1.25 / -1.75', 'diario', 1, 30, 240.0, true, false, false, 10, false, true),
('Alcon', 'Air Optix Colors', 'Lotrafilcon B', 138.0, -6.0, 6.0, NULL, NULL, NULL, 'mensal', 30, 2, 210.0, false, true, false, 10, false, true),
('Alcon', 'FreshLook COLORBLENDS', 'Phenfilcon A', 20.0, -6.0, 6.0, NULL, NULL, NULL, 'mensal', 30, 2, 205.9, false, true, false, 10, false, true),
('Alcon', 'FreshLook ONE-DAY COLOR', 'Nelfilcon A', 26.0, -6.0, 0.0, NULL, NULL, NULL, 'diario', 1, 10, 200.0, false, true, false, 10, false, true),
('Johnson & Johnson', 'Acuvue 2', 'Etafilcon A', 25.5, -6.0, 8.0, NULL, NULL, NULL, 'quinzenal', 15, 6, 219.9, false, false, false, 10, true, true),
('Johnson & Johnson', 'Acuvue Oasys 1-Day com HydraLuxe', 'Senofilcon A', 121.0, -6.0, 8.0, NULL, NULL, NULL, 'diario', 1, 30, 274.9, false, false, false, 10, false, true),
('Johnson & Johnson', '1-Day Acuvue Moist', 'Etafilcon A', 25.5, -6.0, 6.0, NULL, NULL, NULL, 'diario', 1, 30, 269.9, false, false, false, 10, false, true),
('Johnson & Johnson', 'Acuvue Oasys com Hydraclear Plus', 'Senofilcon A', 147.0, -6.0, 8.0, NULL, NULL, NULL, 'quinzenal', 15, 6, 294.9, false, false, false, 10, true, true),
('Johnson & Johnson', 'Acuvue Oasys 1-Day HydraLuxe Astigmatismo', 'Senofilcon A', 129.0, -6.0, 4.0, -1.75, -0.75, '-0.75 / -1.25 / -1.75', 'diario', 1, 30, 369.9, true, false, false, 10, false, true),
('Johnson & Johnson', 'Acuvue Oasys para Astigmatismo', 'Senofilcon A', 129.0, -6.0, 6.0, -2.75, -0.75, '-0.75 / -1.25 / -1.75 / -2.25 / -2.75', 'quinzenal', 15, 6, 404.9, true, false, false, 10, true, true),
('Johnson & Johnson', '1-Day Acuvue Mois para Astigmatismo', 'Etafilcon A', 23.8, 4.0, 6.0, -2.25, -0.75, '-0.75 / -1.25 / -1.75 / -2.25', 'diario', 1, 30, 369.9, true, false, false, 10, false, true),
('Solótica', 'Hidroblue UV Esférica', 'Filcon I2', 15.0, -25.0, 25.0, NULL, NULL, NULL, 'mensal', 30, 1, 178.0, false, false, false, 10, true, true),
('Solótica', 'Hidroblue K (Ceratogel)', 'Filcon I2', 15.0, -25.0, 6.0, NULL, NULL, NULL, 'mensal', 30, 1, 738.0, false, false, false, 10, true, true),
('Solótica', 'Hidroblue K (Ceratogel) Toric', 'Filcon I2', 15.0, -20.0, 6.0, -5.0, -0.75, '-0.75 / -5.00', 'mensal', 30, 1, 1090.0, true, false, false, 10, true, true),
('Solótica', 'Hidroblue UV Afacia Pediátrica', 'Filcon I2', 15.0, 0.0, 25.0, NULL, NULL, NULL, 'mensal', 30, 1, 558.0, false, false, false, 10, true, true),
('Solótica', 'Hidroblue UV Toric', 'Filcon I2', 15.0, -20.0, 10.0, -7.0, -0.75, '-0.75 / -7.00', 'mensal', 30, 1, 595.0, true, false, false, 10, true, true),
('Solótica', 'Hidrosoft', 'Polymacon 38%', 9.0, -25.0, 25.0, NULL, NULL, NULL, 'anual', 365, 1, 188.0, false, false, false, 10, false, true),
('Solótica', 'Hidrosol', 'Polymacon 38%', 9.0, -25.0, 25.0, NULL, NULL, NULL, 'anual', 365, 1, 308.0, false, false, false, 10, false, true),
('Solótica', 'Hidrosol Filtrante', 'Polymacon 38%', NULL, -25.0, 25.0, NULL, NULL, NULL, 'anual', 365, 1, 1020.0, false, false, false, 10, false, true),
('Solótica', 'Hidrosol Daltonismo', 'Polymacon 38%', NULL, -25.0, 25.0, NULL, NULL, NULL, 'anual', 365, 1, 1020.0, false, true, false, 10, false, true),
('Solótica', 'Hidrocor', 'Polymacon 38%', 9.0, -15.0, 15.0, NULL, NULL, NULL, 'anual', 365, 1, 170.0, false, false, false, 10, false, true),
('Solótica', 'Hidrocor Tórica', 'Polymacon 38%', 9.0, -20.0, 10.0, -7.0, -0.75, '-0.75 / -7.00', 'anual', 365, 1, 815.0, true, false, false, 10, false, true),
('Solótica', 'Natural Colors', 'Polymacon 38%', 9.0, -15.0, 15.0, NULL, NULL, NULL, 'anual', 365, 1, 170.0, false, true, false, 10, false, true),
('Solótica', 'Natural Colors Tórica', 'Polymacon 38%', 9.0, -20.0, 10.0, -7.0, -0.75, '-0.75 / -7.00', 'anual', 365, 1, 815.0, true, true, false, 10, false, true),
('Solótica', 'Aquarella', 'Polymacon 62%', 15.0, -6.0, 0.0, NULL, NULL, NULL, 'trimestral', 90, 2, 175.0, false, false, false, 10, false, true),
('Solótica', 'Solflex Natural Colors', 'Polymacon 38%', 11.25, -5.0, -1.0, NULL, NULL, NULL, 'mensal', 30, 2, 168.0, false, true, false, 10, false, true),
('Solótica', 'Hidrocor Mensal', 'Polymacon 38%', NULL, -5.0, -1.0, NULL, NULL, NULL, 'mensal', 30, 2, 168.0, false, false, false, 10, true, true),
('Solótica', 'Solflex Color Hype', 'Polymacon 38%', 11.25, 0.0, 0.0, NULL, NULL, NULL, 'mensal', 30, 2, 178.0, false, true, false, 10, false, true),
('Solótica', 'Solflex CL', 'Methafilcon 45%', 26.9, -12.0, 0.0, NULL, NULL, NULL, 'mensal', 30, 6, 208.0, false, false, false, 10, true, true),
('Solótica', 'Solflex Toric', 'Hioxifilcon 43%', 22.5, -8.0, 4.0, -2.75, -0.75, '-0.75 / -2.75', 'mensal', 30, 6, 418.0, true, false, false, 10, true, true),
('Solótica', 'Solflex SIHY', 'Avefilcon A', NULL, -12.0, 6.0, NULL, NULL, NULL, 'mensal', 30, 6, 230.0, false, false, false, 10, true, true),
('Coopervision', 'DNZ Mensal', 'Silícone Hidrogel de 3ª Geração', NULL, -12.0, 6.0, NULL, NULL, NULL, 'mensal', 30, 6, 204.99, false, false, true, 1, true, true),
('Coopervision', 'DNZ 1 Day', 'Silícone Hidrogel de 3ª Geração', NULL, -12.0, 8.0, NULL, NULL, NULL, 'diario', 1, 15, 204.99, false, false, true, 1, false, true);