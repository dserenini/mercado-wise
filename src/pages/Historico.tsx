import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Receipt, Store, Calendar, Tag } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface PurchaseItem {
  id: string;
  product_name: string;
  unit_price: number;
  quantity: number;
  total_price: number;
  is_promotion: boolean;
  rating: number | null;
}

interface Purchase {
  id: string;
  supermarket_name: string | null;
  purchase_date: string;
  total_amount: number | null;
  created_at: string;
  items?: PurchaseItem[];
}

export default function Historico() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();

  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (user) {
      fetchPurchases();
    }
  }, [user]);

  const fetchPurchases = async () => {
    const { data, error } = await supabase
      .from("purchase_history")
      .select("*")
      .order("purchase_date", { ascending: false });

    if (error) {
      toast({
        title: "Erro ao carregar histórico",
        description: error.message,
        variant: "destructive",
      });
    } else {
      setPurchases(data || []);
    }
    setLoading(false);
  };

  const fetchItems = async (purchaseId: string) => {
    if (expandedId === purchaseId) {
      setExpandedId(null);
      return;
    }

    const { data, error } = await supabase
      .from("purchase_items")
      .select("*")
      .eq("purchase_id", purchaseId);

    if (!error && data) {
      setPurchases((prev) =>
        prev.map((p) =>
          p.id === purchaseId ? { ...p, items: data } : p
        )
      );
      setExpandedId(purchaseId);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  if (authLoading || loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="container px-4 py-6 animate-fade-in">
        <div className="mb-6">
          <h1 className="font-display font-bold text-2xl">Histórico</h1>
          <p className="text-muted-foreground text-sm">
            {purchases.length} {purchases.length === 1 ? "compra" : "compras"} registradas
          </p>
        </div>

        {purchases.length === 0 ? (
          <Card className="card-elevated">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Receipt className="h-16 w-16 text-muted-foreground mb-4" />
              <h3 className="font-display font-semibold text-lg mb-2">
                Nenhuma compra registrada
              </h3>
              <p className="text-muted-foreground text-center">
                Use o Leitor para adicionar suas compras
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {purchases.map((purchase) => (
              <Card
                key={purchase.id}
                className="card-elevated cursor-pointer hover:shadow-xl transition-all duration-200"
                onClick={() => fetchItems(purchase.id)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-xl bg-primary/10">
                        <Store className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <CardTitle className="text-base">
                          {purchase.supermarket_name || "Loja não informada"}
                        </CardTitle>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                          <Calendar className="h-3 w-3" />
                          {formatDate(purchase.purchase_date)}
                        </div>
                      </div>
                    </div>
                    {purchase.total_amount && (
                      <span className="font-display font-bold text-lg text-primary">
                        {formatCurrency(purchase.total_amount)}
                      </span>
                    )}
                  </div>
                </CardHeader>

                {expandedId === purchase.id && purchase.items && (
                  <CardContent className="pt-0">
                    <div className="border-t border-border pt-4 space-y-3">
                      {purchase.items.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between p-3 bg-muted/50 rounded-xl"
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">
                                {item.product_name}
                              </span>
                              {item.is_promotion && (
                                <Badge variant="secondary" className="bg-accent/20 text-accent text-xs">
                                  <Tag className="h-3 w-3 mr-1" />
                                  Promo
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                              {item.quantity}x {formatCurrency(item.unit_price)}
                            </p>
                          </div>
                          <span className="font-semibold">
                            {formatCurrency(item.total_price || item.unit_price * item.quantity)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
