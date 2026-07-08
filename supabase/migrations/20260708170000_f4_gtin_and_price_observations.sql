-- F4 (roadmap 2026-07-08): scan de gôndola.
-- gtin_catalog: metadados de produto por código de barras (global, cache de
--   Open Food Facts / confirmação do usuário). price_observations: preço visto
--   na gôndola (ou digitado), do usuário — alimenta as médias sem exigir compra.

-- Catálogo GTIN (global; leitura pública, escrita só service role)
CREATE TABLE IF NOT EXISTS public.gtin_catalog (
  gtin         TEXT PRIMARY KEY,
  name         TEXT,
  brand        TEXT,
  package_size NUMERIC,
  package_unit TEXT,
  source       TEXT,                    -- 'openfoodfacts' | 'user'
  found        BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.gtin_catalog ENABLE ROW LEVEL SECURITY;

-- Metadados de produto não são sensíveis; leitura liberada, escrita via service role.
CREATE POLICY "gtin_catalog leitura pública"
  ON public.gtin_catalog FOR SELECT USING (true);

-- Reaproveita o trigger de updated_at criado em product_dictionary.
DROP TRIGGER IF EXISTS trg_gtin_catalog_updated_at ON public.gtin_catalog;
CREATE TRIGGER trg_gtin_catalog_updated_at
  BEFORE UPDATE ON public.gtin_catalog
  FOR EACH ROW EXECUTE FUNCTION update_modified_column();

-- Observações de preço do usuário (RLS) — preço na gôndola, sem exigir compra
CREATE TABLE IF NOT EXISTS public.price_observations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gtin             TEXT,
  product_name     TEXT NOT NULL,       -- conceito escolhido pelo usuário
  brand            TEXT,
  supermarket_name TEXT,
  price            NUMERIC NOT NULL,     -- preço unitário observado
  package_size     NUMERIC,
  package_unit     TEXT,
  source           TEXT NOT NULL DEFAULT 'scan',   -- 'scan' | 'manual'
  observed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.price_observations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own price observations"
  ON public.price_observations FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own price observations"
  ON public.price_observations FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own price observations"
  ON public.price_observations FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_price_observations_user
  ON public.price_observations (user_id, observed_at DESC);
