-- Add package size and unit columns for price-per-unit comparison
ALTER TABLE public.purchase_items 
ADD COLUMN IF NOT EXISTS package_size numeric DEFAULT NULL,
ADD COLUMN IF NOT EXISTS package_unit text DEFAULT 'un';