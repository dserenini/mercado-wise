import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// price_observations ainda não está no types.ts gerado — usa o client sem os
// tipos de tabela para esta feature (regenerar os tipos quando houver CLI).
const sb = supabase as unknown as SupabaseClient;

export interface PriceObservation {
  id: string;
  gtin: string | null;
  product_name: string;
  brand: string | null;
  supermarket_name: string | null;
  price: number;
  package_size: number | null;
  package_unit: string | null;
  source: string;
  observed_at: string;
}

export const PRICE_OBSERVATIONS_KEY = ["price_observations"] as const;

/** Observações de preço do usuário (scan de gôndola). */
export function usePriceObservations() {
  return useQuery({
    queryKey: PRICE_OBSERVATIONS_KEY,
    queryFn: async (): Promise<PriceObservation[]> => {
      const { data, error } = await sb
        .from("price_observations")
        .select("*")
        .order("observed_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PriceObservation[];
    },
  });
}

export interface NewObservation {
  userId: string;
  gtin: string | null;
  product_name: string;
  brand: string | null;
  supermarket_name: string | null;
  price: number;
  package_size: number | null;
  package_unit: string | null;
}

export function useSaveObservation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (o: NewObservation) => {
      const { error } = await sb.from("price_observations").insert({
        user_id: o.userId,
        gtin: o.gtin,
        product_name: o.product_name,
        brand: o.brand,
        supermarket_name: o.supermarket_name,
        price: o.price,
        package_size: o.package_size,
        package_unit: o.package_unit,
        source: "scan",
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: PRICE_OBSERVATIONS_KEY }),
  });
}
