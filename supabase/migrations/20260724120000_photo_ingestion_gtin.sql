-- Pivô de ingestão (2026-07-24): nota entra pela FOTO do cupom (OCR de visão), não mais
-- pelo QR→Sefaz (bloqueado por captcha). A foto do papel expõe o EAN-13 real, que o portal
-- do QR não dava. Ver [[ingestao-sefaz-quebrada]].
--
-- 1) purchase_items ganha o GTIN lido da foto (identidade universal cross-store).
-- 2) receipt_extractions: proveniência da extração por foto — a saída bruta do motor de
--    visão + veredito dos validadores, para reprocessar a normalização sem re-chamar a IA
--    (espelha o papel do receipts_raw/HTML no fluxo antigo).

-- 1) GTIN por item comprado
ALTER TABLE public.purchase_items
  ADD COLUMN IF NOT EXISTS gtin TEXT;

-- Consulta de preço por produto entre mercados (base do comparativo por EAN)
CREATE INDEX IF NOT EXISTS idx_purchase_items_gtin
  ON public.purchase_items (gtin)
  WHERE gtin IS NOT NULL;

-- 2) Extração crua da foto (dado do usuário — RLS). Reprocessável.
CREATE TABLE IF NOT EXISTS public.receipt_extractions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  purchase_id  UUID REFERENCES public.purchase_history(id) ON DELETE CASCADE,
  engine       TEXT NOT NULL,            -- ex.: 'gemini-2.5-flash'
  extraction   JSONB NOT NULL,           -- ReceiptExtraction.to_dict() bruto
  semaforo     TEXT,                     -- 'verde' | 'amarelo' | 'vermelho'
  access_key   TEXT,                     -- se o QR da mesma foto foi lido
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.receipt_extractions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own receipt extractions"
  ON public.receipt_extractions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own receipt extractions"
  ON public.receipt_extractions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own receipt extractions"
  ON public.receipt_extractions FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_receipt_extractions_user
  ON public.receipt_extractions (user_id, created_at DESC);
