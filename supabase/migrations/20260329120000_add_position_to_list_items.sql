-- Adiciona a coluna position na tabela list_items 
ALTER TABLE public.list_items ADD COLUMN IF NOT EXISTS "position" integer DEFAULT 0;

-- Atualiza as politicas se necessário ou atualiza os itens existentes
UPDATE public.list_items SET "position" = 0 WHERE "position" IS NULL;
