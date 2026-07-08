import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Store, TrendingDown, MapPin } from "lucide-react";
import {
  computeProductMarketComparisons,
  formatCurrency,
  type AnalyticsItem,
} from "@/lib/analytics";

interface Props {
  items: AnalyticsItem[];
}

const formatDate = (date: string) =>
  new Date(date).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "2-digit" });

/** 3.1 — Onde o mesmo produto está mais barato (entre os mercados que você já visitou). */
export function ProductMarketComparison({ items }: Props) {
  const comparisons = useMemo(() => computeProductMarketComparisons(items), [items]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const selected = useMemo(
    () => comparisons.find((c) => c.key === selectedKey) ?? null,
    [comparisons, selectedKey],
  );

  if (comparisons.length === 0) {
    return (
      <Card className="card-elevated">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary" />
            Mesmo Produto, Onde é Mais Barato
          </CardTitle>
          <CardDescription>Compare o preço de um produto entre os mercados</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <Store className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p className="text-sm">
              Compre o mesmo produto em mercados diferentes para ver onde compensa mais.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const cheapest = selected?.markets[0];

  return (
    <Card className="card-elevated">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <MapPin className="h-5 w-5 text-primary" />
          Mesmo Produto, Onde é Mais Barato
        </CardTitle>
        <CardDescription>Preço mais recente de cada mercado (por unidade)</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Select value={selectedKey ?? ""} onValueChange={(v) => setSelectedKey(v || null)}>
          <SelectTrigger>
            <SelectValue placeholder="Selecione um produto" />
          </SelectTrigger>
          <SelectContent>
            {comparisons.map((c) => (
              <SelectItem key={c.key} value={c.key}>
                {c.displayName} ({c.markets.length} mercados)
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {selected && cheapest && (
          <div className="space-y-2 mt-3">
            {selected.markets.map((m, index) => {
              const deltaPct =
                cheapest.value > 0 ? ((m.value - cheapest.value) / cheapest.value) * 100 : 0;
              return (
                <div
                  key={m.market}
                  className={`flex items-center justify-between p-3 rounded-xl ${
                    index === 0 ? "bg-primary/10 border-2 border-primary/30" : "bg-muted/50"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{m.market}</span>
                      {index === 0 && (
                        <Badge className="bg-primary/20 text-primary text-xs shrink-0">
                          <TrendingDown className="h-3 w-3 mr-1" />
                          Mais barato
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">visto em {formatDate(m.date)}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`font-bold ${index === 0 ? "text-primary" : ""}`}>
                      {formatCurrency(m.value)}/{selected.unit}
                    </p>
                    {index > 0 && deltaPct > 0 && (
                      <p className="text-xs text-[hsl(var(--price-expensive))]">+{deltaPct.toFixed(0)}%</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
