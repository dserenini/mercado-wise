import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ShoppingList {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

export const SHOPPING_LISTS_KEY = ["shopping_lists"] as const;

export function useShoppingLists() {
  return useQuery({
    queryKey: SHOPPING_LISTS_KEY,
    queryFn: async (): Promise<ShoppingList[]> => {
      const { data, error } = await supabase
        .from("shopping_lists")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, userId }: { name: string; userId: string }) => {
      const { error } = await supabase
        .from("shopping_lists")
        .insert({ name, user_id: userId });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: SHOPPING_LISTS_KEY }),
  });
}

export function useDeleteList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("shopping_lists").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: SHOPPING_LISTS_KEY }),
  });
}
