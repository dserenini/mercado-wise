-- ============================================================
-- Adiciona coluna cnpj_base à supermarket_aliases
-- CNPJ base = primeiros 8 dígitos do CNPJ (identifica o grupo/empresa)
-- Isso permite lookup por CNPJ extraído da URL do QR Code,
-- que é muito mais confiável do que o nome da razão social.
-- ============================================================

ALTER TABLE public.supermarket_aliases
    ADD COLUMN IF NOT EXISTS cnpj_base CHAR(8) DEFAULT NULL;

-- Índice único para busca por CNPJ base (apenas quando preenchido)
CREATE UNIQUE INDEX IF NOT EXISTS idx_supermarket_aliases_cnpj_base
    ON public.supermarket_aliases (cnpj_base)
    WHERE cnpj_base IS NOT NULL;

-- ============================================================
-- Atualiza registros com CNPJ base conhecidos
-- e adiciona alias especial para Supernosso (franquia)
-- ============================================================

-- EPA Supermercados (DMA Distribuidora de Alimentos S.A.)
-- CNPJ base confirmado nos logs: 01928075
UPDATE public.supermarket_aliases
    SET cnpj_base = '01928075'
    WHERE lower(alias) = lower('DMA DISTRIBUIDORA');

-- Supernosso: cada loja é franquia com CNPJ próprio,
-- mas TODAS as razões sociais contêm " SN " ou "SN XXX"
-- Adicionamos alias "SN" com prioridade baixa (para não conflitar com outros)
INSERT INTO public.supermarket_aliases (alias, display_name, priority, notes)
VALUES (' SN ', 'SuperNosso', 20, 'Franquia Supernosso — todas as unidades têm SN no nome')
ON CONFLICT (lower(alias)) DO UPDATE
    SET display_name = EXCLUDED.display_name,
        priority     = EXCLUDED.priority,
        notes        = EXCLUDED.notes,
        updated_at   = now();
