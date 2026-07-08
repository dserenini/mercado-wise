import { useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trophy, Store } from "lucide-react";
import { computeMarketRanking, type AnalyticsItem } from "@/lib/analytics";

interface Props {
  items: AnalyticsItem[];
}

/** 3.3 — Qual mercado tem melhor custo-benefício para o SEU padrão de consumo. */
export function MarketRanking({ items }: Props) {
  const ranks = useMemo(() => computeMarketRanking(items), [items]);

  if (ranks.length < 2) {
    return (
      <Card className="card-elevated">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Trophy className="h-5 w-5 text-primary" />
            Melhor Mercado pra Você
          </CardTitle>
          <CardDescription>Custo-benefício segundo o seu padrão de consumo</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <Store className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p className="text-sm">
              Registre compras dos mesmos produtos em mais de um mercado para comparar.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="card-elevated">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Trophy className="h-5 w-5 text-primary" />
          Melhor Mercado pra Você
        </CardTitle>
        <CardDescription>
          Comparado à sua média de preços, ponderado pelo que você mais compra
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {ranks.map((r, index) => {
          const deltaPct = (r.index - 1) * 100;
          const cheaper = deltaPct < -0.5;
          const pricier = deltaPct > 0.5;
          return (
            <div
              key={r.market}
              className={`flex items-center justify-between p-3 rounded-xl ${
                index === 0 ? "bg-primary/10 border-2 border-primary/30" : "bg-muted/50"
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-sm font-bold text-muted-foreground w-4 shrink-0">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{r.market}</span>
                    {index === 0 && (
                      <Badge className="bg-primary/20 text-primary text-xs shrink-0">Melhor</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {r.coverage} {r.coverage === 1 ? "produto seu" : "produtos seus"}
                  </p>
                </div>
              </div>
              <div className="text-right shrink-0">
                {cheaper ? (
                  <span className="text-sm font-bold text-[hsl(var(--price-good))]">
                    {deltaPct.toFixed(0)}%
                  </span>
                ) : pricier ? (
                  <span className="text-sm font-bold text-[hsl(var(--price-expensive))]">
                    +{deltaPct.toFixed(0)}%
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">na média</span>
                )}
                <p className="text-xs text-muted-foreground">vs. sua média</p>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
