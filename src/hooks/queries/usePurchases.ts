import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface PurchaseItem {
  id: string;
  product_name: string;
  brand?: string | null;
  unit_price: number;
  quantity: number;
  total_price: number;
  is_promotion: boolean;
  rating: number | null;
  package_size: number | null;
  package_unit: string | null;
}

export interface Purchase {
  id: string;
  supermarket_name: string | null;
  purchase_date: string;
  total_amount: number | null;
  created_at: string;
}

export interface PurchaseWithItems extends Purchase {
  purchase_items: PurchaseItem[];
}

export const PURCHASES_KEY = ["purchase_history"] as const;
export const PURCHASES_WITH_ITEMS_KEY = ["purchase_history", "with_items"] as const;

/** Lista de compras (sem itens) — usada no Histórico, itens carregados sob demanda. */
export function usePurchases() {
  return useQuery({
    queryKey: PURCHASES_KEY,
    queryFn: async (): Promise<Purchase[]> => {
      const { data, error } = await supabase
        .from("purchase_history")
        .select("*")
        .order("purchase_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Compras com itens aninhados — usada nos Insights (ascendente para os gráficos). */
export function usePurchasesWithItems() {
  return useQuery({
    queryKey: PURCHASES_WITH_ITEMS_KEY,
    queryFn: async (): Promise<PurchaseWithItems[]> => {
      const { data, error } = await supabase
        .from("purchase_history")
        .select("*, purchase_items(*)")
        .order("purchase_date", { ascending: true });
      if (error) throw error;
      return (data as PurchaseWithItems[]) ?? [];
    },
  });
}

/** Itens ativos de uma compra — carregados sob demanda ao expandir. */
export function usePurchaseItems(purchaseId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["purchase_items", purchaseId],
    enabled: enabled && !!purchaseId,
    queryFn: async (): Promise<PurchaseItem[]> => {
      const { data, error } = await supabase
        .from("purchase_items")
        .select("*")
        .eq("purchase_id", purchaseId as string)
        .eq("is_active", true);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useDeletePurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (purchaseId: string) => {
      // Itens primeiro (FK), depois o cabeçalho
      await supabase.from("purchase_items").delete().eq("purchase_id", purchaseId);
      const { error } = await supabase.from("purchase_history").delete().eq("id", purchaseId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: PURCHASES_KEY }),
  });
}

export interface ManualItemRow {
  id?: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  is_promotion: boolean;
  package_size: number | null;
  package_unit: string | null;
  is_active: boolean;
}

export interface SaveManualPayload {
  editingId?: string;
  userId: string;
  supermarketName: string;
  purchaseDate: string;
  totalAmount: number;
  items: ManualItemRow[];
}

export function useSaveManualPurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: SaveManualPayload): Promise<string> => {
      const header = {
        supermarket_name: p.supermarketName,
        purchase_date: p.purchaseDate,
        total_amount: p.totalAmount,
      };

      let purchaseId = p.editingId;
      if (p.editingId) {
        const { error } = await supabase
          .from("purchase_history")
          .update(header)
          .eq("id", p.editingId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("purchase_history")
          .insert({ user_id: p.userId, ...header })
          .select()
          .single();
        if (error) throw error;
        purchaseId = data.id;
      }
      if (!purchaseId) throw new Error("ID da compra ausente.");

      // Upsert: linhas com id atualizam; sem id inserem (id gerado pelo banco)
      const rows = p.items.map((it) => {
        const { id, ...rest } = it;
        return id ? { id, purchase_id: purchaseId, ...rest } : { purchase_id: purchaseId, ...rest };
      });
      const { error: itemsError } = await supabase.from("purchase_items").upsert(rows);
      if (itemsError) throw itemsError;

      return purchaseId;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PURCHASES_KEY });
      qc.invalidateQueries({ queryKey: ["purchase_items"] });
    },
  });
}
