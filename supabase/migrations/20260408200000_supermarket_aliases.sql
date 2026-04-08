-- ============================================================
-- Tabela: supermarket_aliases
-- Mapeia nomes brutos da Sefaz (razão social / substring do CNPJ)
-- para nomes de exibição amigáveis no app.
--
-- Como usar:
--   - `alias`        → qualquer substring que apareça no nome bruto da nota
--                      (case-insensitive). Ex: "DMA" aparece em "DMA DISTRIBUIDORA S/A"
--   - `display_name` → nome limpo exibido para o usuário. Ex: "EPA Supermercados"
--   - `priority`     → quanto menor, maior prioridade na busca (evita matches genéricos)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.supermarket_aliases (
    id           SERIAL PRIMARY KEY,
    alias        TEXT NOT NULL,               -- substring da razão social na Sefaz
    display_name TEXT NOT NULL,               -- nome amigável para exibição
    priority     INT  NOT NULL DEFAULT 100,   -- menor = verificado primeiro
    notes        TEXT,                        -- observações (opcional)
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índice para busca rápida (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS idx_supermarket_aliases_alias
    ON public.supermarket_aliases (lower(alias));

-- Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_supermarket_aliases_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_supermarket_aliases_updated_at
    BEFORE UPDATE ON public.supermarket_aliases
    FOR EACH ROW EXECUTE FUNCTION update_supermarket_aliases_updated_at();

-- RLS: tabela pública para leitura (apenas service role pode escrever)
ALTER TABLE public.supermarket_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Leitura pública de aliases"
    ON public.supermarket_aliases FOR SELECT
    USING (true);

-- ============================================================
-- SEED INICIAL — Supermercados de Minas Gerais
-- ============================================================

INSERT INTO public.supermarket_aliases (alias, display_name, priority, notes) VALUES

-- EPA Supermercados
-- Razão social: DMA DISTRIBUIDORA DE ALIMENTOS S.A.
('DMA DISTRIBUIDORA',     'EPA Supermercados', 10, 'Razão social do grupo EPA em MG'),
('DMA',                   'EPA Supermercados', 50, 'Abreviação da DMA Distribuidora'),

-- BH Supermercados
-- Razão social: COMPANHIA BRASILEIRA DE DISTRIBUICAO / BH SUPERMERCADOS
('SUPERNOSSO',            'SuperNosso',        10, 'Rede SuperNosso de BH'),
('SUPER NOSSO',           'SuperNosso',        10, 'Variação com espaço'),

-- Verdemar
('VERDEMAR',              'Verdemar',          10, 'Rede Verdemar de BH'),

-- Carrefour
('CARREFOUR',             'Carrefour',         10, 'Carrefour Comércio e Indústria Ltda'),
('ATACADAO',              'Atacadão',          10, 'Atacadão (grupo Carrefour)'),

-- BH Supermercados
('BH SUPERMERCADOS',      'BH Supermercados',  10, 'Rede BH Supermercados'),
('SUPERMERCADOS BH',      'BH Supermercados',  10, 'Variação do nome BH Supermercados'),

-- Apoio Mineiro
('SUPERMERCADOS APOIO',   'Apoio Mineiro',     10, 'Razão social: Supermercados Apoio Ltda'),
('APOIO MINEIRO',         'Apoio Mineiro',     10, 'Nome comercial Apoio Mineiro'),
('APOIO',                 'Apoio Mineiro',    100, 'Alias genérico — usar com cuidado'),

-- Outros comuns em MG
('ASSAI',                 'Assaí',             10, 'Assaí Atacadista'),
('ASSAÍ',                 'Assaí',             10, 'Assaí Atacadista (com acento)'),
('MAKRO',                 'Makro',             10, 'Makro Atacadista'),
('MINEIRAO',              'Mineirão',          10, 'Mineirão Supermercados MG'),
('MINEIRÃO',              'Mineirão',          10, 'Mineirão Supermercados MG (com acento)'),
('NAGUMO',                'Nagumo',            10, 'Nagumo Supermercados MG'),
('ECOMIX',                'Ecomix',            10, 'Ecomix Supermercados'),
('WALMART',               'Walmart',           10, 'Walmart Brasil'),
('SAM''S CLUB',           'Sam''s Club',       10, 'Sam''s Club (grupo Walmart)'),
('PAO DE ACUCAR',         'Pão de Açúcar',     10, 'Pão de Açúcar (grupo GPA)'),
('PÃO DE AÇÚCAR',         'Pão de Açúcar',     10, 'Pão de Açúcar com acento')

ON CONFLICT (lower(alias)) DO UPDATE
    SET display_name = EXCLUDED.display_name,
        priority     = EXCLUDED.priority,
        notes        = EXCLUDED.notes,
        updated_at   = now();
