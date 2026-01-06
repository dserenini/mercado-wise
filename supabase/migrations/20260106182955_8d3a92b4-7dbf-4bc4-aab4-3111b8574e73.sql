-- Mercado Fácil Database Schema

-- Profiles table (linked to auth.users)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Supermarkets table
CREATE TABLE public.supermarkets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address TEXT,
  city TEXT DEFAULT 'Minas Gerais',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Products catalog table
CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT,
  unit TEXT DEFAULT 'un',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Shopping lists table
CREATE TABLE public.shopping_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- List items table
CREATE TABLE public.list_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID REFERENCES public.shopping_lists(id) ON DELETE CASCADE NOT NULL,
  product_id UUID REFERENCES public.products(id),
  product_name TEXT NOT NULL,
  quantity DECIMAL(10, 2) DEFAULT 1,
  unit TEXT DEFAULT 'un',
  is_checked BOOLEAN DEFAULT false,
  estimated_price DECIMAL(10, 2),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Purchase history table
CREATE TABLE public.purchase_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  supermarket_id UUID REFERENCES public.supermarkets(id),
  supermarket_name TEXT,
  purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
  total_amount DECIMAL(10, 2),
  nfc_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Purchase items table (items within a purchase)
CREATE TABLE public.purchase_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id UUID REFERENCES public.purchase_history(id) ON DELETE CASCADE NOT NULL,
  product_id UUID REFERENCES public.products(id),
  product_name TEXT NOT NULL,
  unit_price DECIMAL(10, 2) NOT NULL,
  quantity DECIMAL(10, 2) DEFAULT 1,
  total_price DECIMAL(10, 2),
  is_promotion BOOLEAN DEFAULT false,
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supermarkets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopping_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.list_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Supermarkets policies (public read, authenticated insert)
CREATE POLICY "Anyone can view supermarkets" ON public.supermarkets FOR SELECT USING (true);
CREATE POLICY "Authenticated users can add supermarkets" ON public.supermarkets FOR INSERT TO authenticated WITH CHECK (true);

-- Products policies (public read, authenticated insert)
CREATE POLICY "Anyone can view products" ON public.products FOR SELECT USING (true);
CREATE POLICY "Authenticated users can add products" ON public.products FOR INSERT TO authenticated WITH CHECK (true);

-- Shopping lists policies
CREATE POLICY "Users can view own lists" ON public.shopping_lists FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own lists" ON public.shopping_lists FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own lists" ON public.shopping_lists FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own lists" ON public.shopping_lists FOR DELETE USING (auth.uid() = user_id);

-- List items policies (through list ownership)
CREATE POLICY "Users can view own list items" ON public.list_items FOR SELECT 
  USING (EXISTS (SELECT 1 FROM public.shopping_lists WHERE id = list_items.list_id AND user_id = auth.uid()));
CREATE POLICY "Users can add items to own lists" ON public.list_items FOR INSERT 
  WITH CHECK (EXISTS (SELECT 1 FROM public.shopping_lists WHERE id = list_items.list_id AND user_id = auth.uid()));
CREATE POLICY "Users can update own list items" ON public.list_items FOR UPDATE 
  USING (EXISTS (SELECT 1 FROM public.shopping_lists WHERE id = list_items.list_id AND user_id = auth.uid()));
CREATE POLICY "Users can delete own list items" ON public.list_items FOR DELETE 
  USING (EXISTS (SELECT 1 FROM public.shopping_lists WHERE id = list_items.list_id AND user_id = auth.uid()));

-- Purchase history policies
CREATE POLICY "Users can view own purchases" ON public.purchase_history FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can add purchases" ON public.purchase_history FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own purchases" ON public.purchase_history FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own purchases" ON public.purchase_history FOR DELETE USING (auth.uid() = user_id);

-- Purchase items policies (through purchase ownership)
CREATE POLICY "Users can view own purchase items" ON public.purchase_items FOR SELECT 
  USING (EXISTS (SELECT 1 FROM public.purchase_history WHERE id = purchase_items.purchase_id AND user_id = auth.uid()));
CREATE POLICY "Users can add purchase items" ON public.purchase_items FOR INSERT 
  WITH CHECK (EXISTS (SELECT 1 FROM public.purchase_history WHERE id = purchase_items.purchase_id AND user_id = auth.uid()));

-- Function to handle profile creation on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name)
  VALUES (new.id, new.raw_user_meta_data ->> 'full_name');
  RETURN new;
END;
$$;

-- Trigger to create profile on signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Timestamp triggers
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_shopping_lists_updated_at BEFORE UPDATE ON public.shopping_lists FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();