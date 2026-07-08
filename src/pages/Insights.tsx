import { useState, useEffect, useMemo } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { usePurchasesWithItems } from "@/hooks/queries/usePurchases";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, TrendingUp, TrendingDown, Store, ShoppingBag, BarChart3 } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useToast } from "@/hooks/use-toast";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { PriceComparison } from "@/components/PriceComparison";
import { ProductMarketComparison } from "@/components/ProductMarketComparison";
import { MarketRanking } from "@/components/MarketRanking";
import { formatCurrency } from "@/lib/analytics";

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

interface PurchaseItemWithDetails {
  id: string;
  product_name: string;
  unit_price: number;
  quantity: number;
  total_price: number;
  package_size: number | null;
  package_unit: string | null;
  purchase_date: string;
  supermarket_name: string | null;
}

export default function Insights() {
  const { toast } = useToast();

  const { data: purchases = [], isLoading: loading, error } = usePurchasesWithItems();

  const [timeFilter, setTimeFilter] = useState("3M"); // 1M, 3M, 6M, 1Yr, YTD, All
  const [selectedYear, setSelectedYear] = useState<string>(new Date().getFullYear().toString());

  // Derived Metrics States
  const [monthlySpent, setMonthlySpent] = useState(0);
  const [monthlyCount, setMonthlyCount] = useState(0);
  const [mostFrequentStore, setMostFrequentStore] = useState<{ name: string; count: number } | null>(null);

  // Chart & List Data
  const [filteredPriceHistory, setFilteredPriceHistory] = useState<PriceData[]>([]);
  const [filteredStoreHistory, setFilteredStoreHistory] = useState<{ name: string; total: number }[]>([]);
  const [productStats, setProductStats] = useState<ProductStats[]>([]);

  useEffect(() => {
    if (error) {
      toast({
        title: "Erro ao carregar insights",
        description: (error as Error).message,
        variant: "destructive",
      });
    }
  }, [error, toast]);

  // Itens achatados para o PriceComparison
  const allsItems = useMemo<PurchaseItemWithDetails[]>(() => {
    const items: PurchaseItemWithDetails[] = [];
    purchases.forEach((p) => {
      (p.purchase_items ?? []).forEach((item) => {
        items.push({
          id: item.id,
          product_name: item.product_name,
          unit_price: item.unit_price,
          quantity: item.quantity || 1,
          total_price: item.total_price || item.unit_price * (item.quantity || 1),
          package_size: item.package_size,
          package_unit: item.package_unit,
          purchase_date: p.purchase_date,
          supermarket_name: p.supermarket_name,
        });
      });
    });
    return items;
  }, [purchases]);

  // Recalcula métricas derivadas quando compras ou filtros mudam
  useEffect(() => {
    if (purchases.length > 0) {
      calculateMonthlyMetrics();
      calculateMostFrequentStore();
      calculateFilteredData();
      calculateProductStats();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchases, timeFilter, selectedYear]);

  const calculateMonthlyMetrics = () => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const monthlyPurchases = purchases.filter(p => new Date(p.purchase_date) >= startOfMonth);

    setMonthlySpent(monthlyPurchases.reduce((sum, p) => sum + (p.total_amount || 0), 0));
    setMonthlyCount(monthlyPurchases.length);
  };

  const calculateMostFrequentStore = () => {
    const yearPurchases = purchases.filter(p =>
      new Date(p.purchase_date).getFullYear().toString() === selectedYear
    );

    const storeCounts = new Map<string, number>();
    yearPurchases.forEach(p => {
      if (p.supermarket_name) {
        storeCounts.set(p.supermarket_name, (storeCounts.get(p.supermarket_name) || 0) + 1);
      }
    });

    let maxStore = null;
    let maxCount = 0;

    storeCounts.forEach((count, name) => {
      if (count > maxCount) {
        maxCount = count;
        maxStore = { name, count };
      }
    });

    setMostFrequentStore(maxStore);
  };

  const calculateFilteredData = () => {
    const now = new Date();
    let startDate = new Date(0); // Default all

    switch (timeFilter) {
      case "1M":
        startDate = new Date();
        startDate.setMonth(now.getMonth() - 1);
        break;
      case "3M":
        startDate = new Date();
        startDate.setMonth(now.getMonth() - 3);
        break;
      case "6M":
        startDate = new Date();
        startDate.setMonth(now.getMonth() - 6);
        break;
      case "1Yr":
        startDate = new Date();
        startDate.setFullYear(now.getFullYear() - 1);
        break;
      case "YTD":
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      case "All":
        startDate = new Date(0);
        break;
    }

    const filteredPurchases = purchases.filter(p => new Date(p.purchase_date) >= startDate);

    // Chart Data
    const chartData = filteredPurchases.map(p => ({
      date: new Date(p.purchase_date).toLocaleDateString("pt-BR", { day: '2-digit', month: 'short' }),
      price: p.total_amount || 0
    }));
    setFilteredPriceHistory(chartData);

    // Market History List Data
    const storeTotals = new Map<string, number>();
    filteredPurchases.forEach(p => {
      if (p.supermarket_name) {
        storeTotals.set(p.supermarket_name, (storeTotals.get(p.supermarket_name) || 0) + (p.total_amount || 0));
      }
    });

    const storeList = Array.from(storeTotals.entries())
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total);

    setFilteredStoreHistory(storeList);
  };

  const calculateProductStats = () => {
    // Keep existing logic for top products (using ALL data usually, or could be filtered? Request said "keep existing logic", which used all purchases)
    // Re-implementing logic from original file roughly
    const products = new Map<string, { prices: number[]; count: number }>();

    purchases.forEach((p) => {
      if (p.purchase_items) {
        p.purchase_items.forEach((item) => {
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
  };

  const getAvailableYears = () => {
    const years = new Set(purchases.map(p => new Date(p.purchase_date).getFullYear().toString()));
    const currentYear = new Date().getFullYear().toString();
    years.add(currentYear);
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  };


  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  const hasData = purchases.length > 0;

  return (
    <AppLayout>
      <div className="container px-4 py-6 animate-fade-in pb-20">
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
          <div className="space-y-6">

            {/* 1. Monthly Cards */}
            <div className="grid grid-cols-2 gap-4">
              <Card className="card-elevated">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-primary/10">
                      <ShoppingBag className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Gasto (Este Mês)</p>
                      <p className="font-display font-bold text-lg">
                        {formatCurrency(monthlySpent)}
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
                      <p className="text-xs text-muted-foreground">Compras (Este Mês)</p>
                      <p className="font-display font-bold text-lg">
                        {monthlyCount}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* 2. Most Frequent Market (Yearly) */}
            <Card className="card-elevated border-l-4 border-l-primary">
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-base text-muted-foreground font-normal">
                  Mercado Mais Frequentado
                </CardTitle>
                <Select value={selectedYear} onValueChange={setSelectedYear}>
                  <SelectTrigger className="w-[100px] h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {getAvailableYears().map(year => (
                      <SelectItem key={year} value={year}>{year}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardHeader>
              <CardContent>
                {mostFrequentStore ? (
                  <div className="flex items-center gap-4">
                    <div className="p-3 rounded-full bg-primary/10">
                      <Store className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <p className="font-display font-bold text-xl">{mostFrequentStore.name}</p>
                      <p className="text-sm text-muted-foreground">{mostFrequentStore.count} visitas em {selectedYear}</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic">Nenhuma compra neste ano.</p>
                )}
              </CardContent>
            </Card>


            {/* Controls for Time Filter (Shared) */}
            <div className="flex gap-2 overflow-x-auto pb-2 noscroll-bar">
              {['1M', '3M', '6M', '1Yr', 'YTD', 'All'].map((filter) => (
                <Button
                  key={filter}
                  variant={timeFilter === filter ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTimeFilter(filter)}
                  className="rounded-full px-4"
                >
                  {filter}
                </Button>
              ))}
            </div>

            {/* 3. Spend Evolution Chart */}
            <Card className="card-elevated">
              <CardHeader className="pb-4">
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  Evolução dos Gastos
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[200px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={filteredPriceHistory}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10 }}
                        stroke="hsl(var(--muted-foreground))"
                        tickLine={false}
                        axisLine={false}
                        minTickGap={20}
                      />
                      <YAxis
                        tick={{ fontSize: 10 }}
                        stroke="hsl(var(--muted-foreground))"
                        tickFormatter={(value) => `R$${value}`}
                        tickLine={false}
                        axisLine={false}
                        width={40}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "0.75rem",
                          fontSize: '12px'
                        }}
                        formatter={(value: number) => [formatCurrency(value), "Valor"]}
                      />
                      <Line
                        type="monotone"
                        dataKey="price"
                        stroke="hsl(var(--primary))"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4, fill: "hsl(var(--primary))" }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>


            {/* 4. Market History List */}
            <Card className="card-elevated">
              <CardHeader>
                <CardTitle className="text-base">Histórico por Mercado</CardTitle>
                <CardDescription className="text-xs">Gastos no período selecionado ({timeFilter})</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {filteredStoreHistory.length > 0 ? (
                  filteredStoreHistory.map((store, index) => (
                    <div key={store.name} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-bold text-muted-foreground w-4">{index + 1}</span>
                        <span className="text-sm font-medium">{store.name}</span>
                      </div>
                      <span className="text-sm font-bold text-primary">{formatCurrency(store.total)}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground text-center py-4">Sem dados para este período.</p>
                )}
              </CardContent>
            </Card>

            {/* 5. Top Products */}
            {productStats.length > 0 && (
              <Card className="card-elevated">
                <CardHeader>
                  <CardTitle className="text-base">Produtos Mais Comprados</CardTitle>
                  <CardDescription>Geral</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {productStats.map((product, index) => {
                    const priceVariation =
                      product.average_price > 0 ? ((product.max_price - product.min_price) / product.average_price) * 100 : 0;
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
                                  Var {priceVariation.toFixed(0)}%
                                </span>
                              </>
                            ) : (
                              <span className="text-muted-foreground">Estável</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}

            {/* 6. Melhor mercado pro seu cesto (3.3) */}
            <MarketRanking items={allsItems} />

            {/* 7. Mesmo produto entre mercados (3.1) */}
            <ProductMarketComparison items={allsItems} />

            {/* 8. Price Comparison (embalagens) */}
            <PriceComparison items={allsItems} />

          </div>
        )}
      </div>
    </AppLayout>
  );
}
