import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ListItem {
  id: string;
  list_id: string;
  product_name: string;
  is_checked: boolean;
  quantity: number | null;
  unit: string | null;
  position: number | null;
}

export interface ShoppingListDetail {
  id: string;
  name: string;
  is_active: boolean;
}

export function useList(listId: string | undefined) {
  return useQuery({
    queryKey: ["shopping_list", listId],
    enabled: !!listId,
    queryFn: async (): Promise<ShoppingListDetail> => {
      const { data, error } = await supabase
        .from("shopping_lists")
        .select("*")
        .eq("id", listId as string)
        .single();
      if (error) throw error;
      return data;
    },
  });
}

export function useListItems(listId: string | undefined) {
  return useQuery({
    queryKey: ["list_items", listId],
    enabled: !!listId,
    queryFn: async (): Promise<ListItem[]> => {
      const { data, error } = await supabase
        .from("list_items")
        .select("*")
        .eq("list_id", listId as string)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}
