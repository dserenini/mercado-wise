-- ============================================================
-- W5 — Índices de deduplicação + sincronização de schema
-- ============================================================
-- Tudo idempotente (IF NOT EXISTS): não altera o banco atual em produção,
-- mas garante que um banco recriado do zero a partir das migrations fique
-- IDÊNTICO ao de produção (importante para o deploy limpo).

-- ── 1. Índices para acelerar check_duplicate (backend/app/services/dedup.py) ──

-- Camada 1: lookup por URL da NFC-e
CREATE INDEX IF NOT EXISTS idx_purchase_history_user_nfc_url
    ON public.purchase_history (user_id, nfc_url);

-- Camada 2: lookup por mercado + data
CREATE INDEX IF NOT EXISTS idx_purchase_history_user_market_date
    ON public.purchase_history (user_id, supermarket_name, purchase_date);

-- Join de itens (dedup por fingerprint + expansão do histórico).
-- Postgres NÃO indexa foreign keys automaticamente.
CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase_id
    ON public.purchase_items (purchase_id);

-- ── 2. Sincronização de schema ───────────────────────────────
-- Estas colunas JÁ existem em produção (criadas fora do versionamento),
-- mas faltavam nas migrations. Referenciadas em src/pages/Historico.tsx
-- e src/pages/Insights.tsx.
ALTER TABLE public.purchase_items
    ADD COLUMN IF NOT EXISTS is_active    BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS package_size NUMERIC,
    ADD COLUMN IF NOT EXISTS package_unit TEXT;

-- ── 3. Revisão de RLS das tabelas globais (sem alterações necessárias) ──
--   product_dictionary : RLS ON; policy FOR ALL só para service_role →
--                        anon/authenticated NÃO leem nem escrevem. Correto.
--   supermarket_aliases: RLS ON; SELECT público (intencional — nomes de
--                        mercado não são sensíveis) e escrita só service_role.
