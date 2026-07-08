import { Badge } from "@/components/ui/badge";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";
import { priceVerdict, type AnalyticsItem, type Benchmark } from "@/lib/analytics";

interface Props {
  item: AnalyticsItem;
  benchmarks: Map<string, Benchmark>;
}

/** 3.2 — Termômetro: mostra se o preço pago está abaixo/na/acima da sua média móvel. */
export function PriceThermometer({ item, benchmarks }: Props) {
  const { verdict, deltaPct } = priceVerdict(item, benchmarks);

  if (verdict === "unknown") return null;

  if (verdict === "below") {
    return (
      <Badge variant="secondary" className="bg-[hsl(var(--price-good))]/15 text-[hsl(var(--price-good))] text-xs">
        <TrendingDown className="h-3 w-3 mr-1" />
        {Math.abs(deltaPct).toFixed(0)}% abaixo
      </Badge>
    );
  }

  if (verdict === "above") {
    return (
      <Badge variant="secondary" className="bg-[hsl(var(--price-expensive))]/15 text-[hsl(var(--price-expensive))] text-xs">
        <TrendingUp className="h-3 w-3 mr-1" />
        {deltaPct.toFixed(0)}% acima
      </Badge>
    );
  }

  return (
    <Badge variant="secondary" className="bg-muted text-muted-foreground text-xs">
      <Minus className="h-3 w-3 mr-1" />
      na média
    </Badge>
  );
}
