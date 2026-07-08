-- F2 (roadmap 2026-07-08): identidade de produto por mercado, granularidade e marca.
-- O dicionário passa a ter identidade primária (cnpj_base, cprod) — estável por
-- mercado — com raw_name como fallback (mercados/histórico sem código interno).

ALTER TABLE public.product_dictionary
  ADD COLUMN IF NOT EXISTS cnpj_base    CHAR(8),
  ADD COLUMN IF NOT EXISTS cprod        TEXT,
  ADD COLUMN IF NOT EXISTS brand        TEXT,
  ADD COLUMN IF NOT EXISTS package_size NUMERIC,
  ADD COLUMN IF NOT EXISTS package_unit TEXT;

-- raw_name deixa de ser globalmente único: o mesmo nome cru aparece em vários
-- mercados, cada um com seu cprod. A unicidade migra para dois namespaces:
--   (cnpj_base, cprod) → entradas específicas por mercado
--   raw_name           → entradas genéricas de fallback (cprod IS NULL)
ALTER TABLE public.product_dictionary
  DROP CONSTRAINT IF EXISTS product_dictionary_raw_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_dictionary_cnpj_cprod
  ON public.product_dictionary (cnpj_base, cprod)
  WHERE cnpj_base IS NOT NULL AND cprod IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_dictionary_raw_name_fallback
  ON public.product_dictionary (raw_name)
  WHERE cprod IS NULL;

-- Marca também na linha da compra (propagada na ingestão), para comparar
-- marcas do mesmo conceito sem perder o agrupamento genérico.
ALTER TABLE public.purchase_items
  ADD COLUMN IF NOT EXISTS brand TEXT;
