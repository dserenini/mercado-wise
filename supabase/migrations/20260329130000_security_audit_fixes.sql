-- CORREÇÕES DE SEGURANÇA E RLS

-- 1. Truncar dados que possam ultrapassar o limite (caso existam) e criar Limites Físicos de Caracteres
-- Tabelas Públicas (Global)
ALTER TABLE public.products ADD CONSTRAINT products_name_len CHECK (char_length(name) <= 150);
ALTER TABLE public.products ADD CONSTRAINT products_category_len CHECK (char_length(category) <= 100);

ALTER TABLE public.supermarkets ADD CONSTRAINT supermarkets_name_len CHECK (char_length(name) <= 150);
ALTER TABLE public.supermarkets ADD CONSTRAINT supermarkets_city_len CHECK (char_length(city) <= 100);

-- Tabelas Locais (Usuário)
ALTER TABLE public.shopping_lists ADD CONSTRAINT shopping_lists_name_len CHECK (char_length(name) <= 150);
ALTER TABLE public.list_items ADD CONSTRAINT list_items_name_len CHECK (char_length(product_name) <= 150);
ALTER TABLE public.purchase_history ADD CONSTRAINT purchase_history_name_len CHECK (char_length(supermarket_name) <= 150);
ALTER TABLE public.purchase_items ADD CONSTRAINT purchase_items_name_len CHECK (char_length(product_name) <= 150);


-- 2. Bloquear Quantidades e Valores Negativos
ALTER TABLE public.list_items ADD CONSTRAINT list_items_qty_positive CHECK (quantity >= 0);
ALTER TABLE public.list_items ADD CONSTRAINT list_items_price_positive CHECK (estimated_price >= 0);

ALTER TABLE public.purchase_history ADD CONSTRAINT purchase_history_amount_positive CHECK (total_amount >= 0);

ALTER TABLE public.purchase_items ADD CONSTRAINT purchase_items_qty_positive CHECK (quantity >= 0);
ALTER TABLE public.purchase_items ADD CONSTRAINT purchase_items_price_positive CHECK (unit_price >= 0);
ALTER TABLE public.purchase_items ADD CONSTRAINT purchase_items_total_positive CHECK (total_price >= 0);


-- 3. Consertar Políticas RLS de Atualização (Adição do WITH CHECK contra Injeção de Dados)

-- Correção na tabela Profiles
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE 
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Correção na tabela Shopping Lists
DROP POLICY IF EXISTS "Users can update own lists" ON public.shopping_lists;
CREATE POLICY "Users can update own lists" ON public.shopping_lists FOR UPDATE 
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Correção na tabela List Items
DROP POLICY IF EXISTS "Users can update own list items" ON public.list_items;
CREATE POLICY "Users can update own list items" ON public.list_items FOR UPDATE 
  USING (EXISTS (SELECT 1 FROM public.shopping_lists WHERE id = list_items.list_id AND user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.shopping_lists WHERE id = list_items.list_id AND user_id = auth.uid()));

-- Correção na tabela Purchase History
DROP POLICY IF EXISTS "Users can update own purchases" ON public.purchase_history;
CREATE POLICY "Users can update own purchases" ON public.purchase_history FOR UPDATE 
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Políticas já existentes que não precisam de correção mantemos como estão.
