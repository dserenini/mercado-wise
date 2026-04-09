-- Enum para os statuses da tradução de produtos
CREATE TYPE product_dict_status AS ENUM ('pending', 'global', 'rejected');

CREATE TABLE IF NOT EXISTS public.product_dictionary (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    raw_name TEXT NOT NULL UNIQUE,
    normalized_name TEXT NOT NULL,
    unit TEXT,
    category TEXT,
    status product_dict_status DEFAULT 'pending'::product_dict_status,
    confidence_score INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Indice para buscas em massa mais rápidas por raw_name
CREATE INDEX IF NOT EXISTS idx_product_dictionary_raw_name ON public.product_dictionary(raw_name);

-- Trigger para auto-atualizar updated_at
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = now();
   RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER trg_product_dictionary_updated_at
BEFORE UPDATE ON public.product_dictionary
FOR EACH ROW
EXECUTE FUNCTION update_modified_column();

-- Habilitar RLS e dar bypass para a nossa Service Role (Backend API)
ALTER TABLE public.product_dictionary ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Apenas Service Role pode ler/escrever no dicionário" 
    ON public.product_dictionary 
    FOR ALL 
    USING (auth.role() = 'service_role');
