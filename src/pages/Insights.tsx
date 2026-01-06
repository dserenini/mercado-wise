import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, TrendingUp, TrendingDown, Store, ShoppingBag, BarChart3 } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useToast } from "@/hooks/use-toast";

interface PriceData {
  date: string;
  price: number;
}

interface StoreStats {
  name: string;
  average_price: number;
  total_purchases: number;
}

interface ProductStats {
  name: string;
  average_price: number;
  min_price: number;
  max_price: number;
  purchase_count: number;
}

export default function Insights() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [priceHistory, setPriceHistory] = useState<PriceData[]>([]);
  const [storeStats, setStoreStats] = useState<StoreStats[]>([]);
  const [productStats, setProductStats] = useState<ProductStats[]>([]);
  const [totalSpent, setTotalSpent] = useState(0);
  const [purchaseCount, setPurchaseCount] = useState(0);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (user) {
      fetchInsights();
    }
  }, [user]);

  const fetchInsights = async () => {
    try {
      // Fetch purchases
      const { data: purchases } = await supabase
        .from("purchase_history")
        .select("*, purchase_items(*)")
        .order("purchase_date", { ascending: true });

      if (purchases) {
        // Calculate total spent
        const total = purchases.reduce((sum, p) => sum + (p.total_amount || 0), 0);
        setTotalSpent(total);
        setPurchaseCount(purchases.length);

        // Process price history for chart
        const priceData = purchases.map((p) => ({
          date: new Date(p.purchase_date).toLocaleDateString("pt-BR", {
            day: "2-digit",
            month: "short",
          }),
          price: p.total_amount || 0,
        }));
        setPriceHistory(priceData);

        // Calculate store stats
        const stores = new Map<string, { total: number; count: number }>();
        purchases.forEach((p) => {
          if (p.supermarket_name) {
            const current = stores.get(p.supermarket_name) || { total: 0, count: 0 };
            stores.set(p.supermarket_name, {
              total: current.total + (p.total_amount || 0),
              count: current.count + 1,
            });
          }
        });

        const storeArray: StoreStats[] = Array.from(stores.entries())
          .map(([name, data]) => ({
            name,
            average_price: data.total / data.count,
            total_purchases: data.count,
          }))
          .sort((a, b) => a.average_price - b.average_price);

        setStoreStats(storeArray);

        // Calculate product stats from items
        const products = new Map<string, { prices: number[]; count: number }>();
        purchases.forEach((p) => {
          if (p.purchase_items) {
            (p.purchase_items as any[]).forEach((item) => {
              const current = products.get(item.product_name) || { prices: [], count: 0 };
              current.prices.push(item.unit_price);
              current.count += 1;
              products.set(item.product_name, current);
            });
          }
        });

        const productArray: ProductStats[] = Array.from(products.entries())
          .map(([name, data]) => ({
            name,
            average_price: data.prices.reduce((a, b) => a + b, 0) / data.prices.length,
            min_price: Math.min(...data.prices),
            max_price: Math.max(...data.prices),
            purchase_count: data.count,
          }))
          .sort((a, b) => b.purchase_count - a.purchase_count)
          .slice(0, 5);

        setProductStats(productArray);
      }
    } catch (error: any) {
      toast({
        title: "Erro ao carregar insights",
        description: error.message,
        variant: "destructive",
      });
    }

    setLoading(false);
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);
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

  const bestStore = storeStats[0];
  const hasData = purchaseCount > 0;

  return (
    <AppLayout>
      <div className="container px-4 py-6 animate-fade-in">
        <div className="mb-6">
          <h1 className="font-display font-bold text-2xl">Insights</h1>
          <p className="text-muted-foreground text-sm">
            Análise das suas compras
          </p>
        </div>

        {!hasData ? (
          <Card className="card-elevated">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <BarChart3 className="h-16 w-16 text-muted-foreground mb-4" />
              <h3 className="font-display font-semibold text-lg mb-2">
                Sem dados ainda
              </h3>
              <p className="text-muted-foreground text-center">
                Registre suas compras para ver análises
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 gap-4">
              <Card className="card-elevated">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-primary/10">
                      <ShoppingBag className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Total Gasto</p>
                      <p className="font-display font-bold text-lg">
                        {formatCurrency(totalSpent)}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="card-elevated">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-accent/10">
                      <TrendingUp className="h-5 w-5 text-accent" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Compras</p>
                      <p className="font-display font-bold text-lg">
                        {purchaseCount}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Best Store Card */}
            {bestStore && (
              <Card className="card-elevated border-2 border-primary/20">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">🏆</span>
                    <CardTitle className="text-base">Melhor Custo-Benefício</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-3 rounded-xl gradient-primary">
                        <Store className="h-6 w-6 text-primary-foreground" />
                      </div>
                      <div>
                        <p className="font-display font-bold text-lg">
                          {bestStore.name}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {bestStore.total_purchases} {bestStore.total_purchases === 1 ? "compra" : "compras"}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Média</p>
                      <p className="font-display font-bold text-primary">
                        {formatCurrency(bestStore.average_price)}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Price Evolution Chart */}
            {priceHistory.length > 1 && (
              <Card className="card-elevated">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-primary" />
                    Evolução dos Gastos
                  </CardTitle>
                  <CardDescription>Valor total por compra</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[200px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={priceHistory}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis
                          dataKey="date"
                          tick={{ fontSize: 12 }}
                          stroke="hsl(var(--muted-foreground))"
                        />
                        <YAxis
                          tick={{ fontSize: 12 }}
                          stroke="hsl(var(--muted-foreground))"
                          tickFormatter={(value) => `R$${value}`}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "0.75rem",
                          }}
                          formatter={(value: number) => [formatCurrency(value), "Valor"]}
                        />
                        <Line
                          type="monotone"
                          dataKey="price"
                          stroke="hsl(var(--primary))"
                          strokeWidth={3}
                          dot={{ fill: "hsl(var(--primary))", strokeWidth: 2 }}
                          activeDot={{ r: 6, fill: "hsl(var(--primary))" }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Top Products */}
            {productStats.length > 0 && (
              <Card className="card-elevated">
                <CardHeader>
                  <CardTitle className="text-base">Produtos Mais Comprados</CardTitle>
                  <CardDescription>Com indicador de preço</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {productStats.map((product, index) => {
                    const priceVariation =
                      ((product.max_price - product.min_price) / product.average_price) * 100;
                    const isGoodDeal = priceVariation > 10;

                    return (
                      <div
                        key={product.name}
                        className="flex items-center justify-between p-3 bg-muted/50 rounded-xl"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-lg font-bold text-muted-foreground w-6">
                            {index + 1}.
                          </span>
                          <div>
                            <p className="font-medium text-sm">{product.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {product.purchase_count}x comprado
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold">
                            {formatCurrency(product.average_price)}
                          </p>
                          <div className="flex items-center gap-1 text-xs">
                            {isGoodDeal ? (
                              <>
                                <TrendingDown className="h-3 w-3 text-[hsl(var(--price-good))]" />
                                <span className="text-[hsl(var(--price-good))]">
                                  Variou {priceVariation.toFixed(0)}%
                                </span>
                              </>
                            ) : (
                              <span className="text-muted-foreground">Preço estável</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}

            {/* Store Comparison */}
            {storeStats.length > 1 && (
              <Card className="card-elevated">
                <CardHeader>
                  <CardTitle className="text-base">Comparativo de Lojas</CardTitle>
                  <CardDescription>Ordenado por menor preço médio</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {storeStats.map((store, index) => (
                    <div
                      key={store.name}
                      className={`flex items-center justify-between p-3 rounded-xl ${
                        index === 0 ? "bg-primary/10" : "bg-muted/50"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <Store
                          className={`h-5 w-5 ${
                            index === 0 ? "text-primary" : "text-muted-foreground"
                          }`}
                        />
                        <div>
                          <p className="font-medium text-sm">{store.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {store.total_purchases} compras
                          </p>
                        </div>
                      </div>
                      <span
                        className={`font-display font-bold ${
                          index === 0 ? "text-primary" : ""
                        }`}
                      >
                        {formatCurrency(store.average_price)}
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
