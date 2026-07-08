-- F1 (roadmap 2026-07-08): fundação de dados.
-- 1) receipts_raw: HTML cru da Sefaz por nota, para reprocessamento retroativo.
-- 2) Proveniência no cabeçalho da compra: chave de acesso, CNPJ, forma de pagamento.
-- 3) Proveniência por item: nome cru, código interno (cProd) e unidade da Sefaz.
-- 4) supermarkets ganha CNPJ para ser alimentada pela ingestão.

-- 1) Cru reprocessável (dado do usuário — RLS)
CREATE TABLE IF NOT EXISTS public.receipts_raw (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  access_key TEXT NOT NULL,
  nfc_url TEXT,
  raw_html TEXT NOT NULL,
  parser_version INT NOT NULL DEFAULT 1,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, access_key)
);

ALTER TABLE public.receipts_raw ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own raw receipts"
  ON public.receipts_raw FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own raw receipts"
  ON public.receipts_raw FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own raw receipts"
  ON public.receipts_raw FOR DELETE
  USING (auth.uid() = user_id);

-- 2) Cabeçalho da compra
ALTER TABLE public.purchase_history
  ADD COLUMN IF NOT EXISTS access_key TEXT,
  ADD COLUMN IF NOT EXISTS cnpj TEXT,
  ADD COLUMN IF NOT EXISTS payment_method TEXT;

-- Dedup camada 1: uma nota (chave de acesso) por usuário
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_history_user_access_key
  ON public.purchase_history (user_id, access_key)
  WHERE access_key IS NOT NULL;

-- 3) Itens: origem preservada (o nome normalizado continua em product_name)
ALTER TABLE public.purchase_items
  ADD COLUMN IF NOT EXISTS raw_name TEXT,
  ADD COLUMN IF NOT EXISTS cprod TEXT,
  ADD COLUMN IF NOT EXISTS unit TEXT;

-- 4) Supermercados identificáveis por CNPJ (tabela global, escrita via service role)
ALTER TABLE public.supermarkets
  ADD COLUMN IF NOT EXISTS cnpj TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_supermarkets_cnpj
  ON public.supermarkets (cnpj)
  WHERE cnpj IS NOT NULL;
