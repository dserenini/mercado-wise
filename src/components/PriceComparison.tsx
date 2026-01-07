import { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Scale, TrendingDown, Package, ArrowRight, Check } from "lucide-react";

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

interface PriceComparisonProps {
  items: PurchaseItemWithDetails[];
}

interface ProductGroup {
  baseName: string;
  variants: PurchaseItemWithDetails[];
}

interface ComparisonItem {
  item: PurchaseItemWithDetails;
  pricePerUnit: number;
  displayUnit: string;
}

// Common unit conversions for normalization
const unitConversions: Record<string, { base: string; factor: number }> = {
  ml: { base: "L", factor: 0.001 },
  l: { base: "L", factor: 1 },
  g: { base: "kg", factor: 0.001 },
  kg: { base: "kg", factor: 1 },
  un: { base: "un", factor: 1 },
};

// Normalize a name for grouping (remove numbers, sizes, etc.)
const normalizeProductName = (name: string): string => {
  return name
    .toLowerCase()
    .replace(/\d+\s*(ml|l|g|kg|un|unid|unidade)/gi, "")
    .replace(/\d+/g, "")
    .replace(/\s+/g, " ")
    .trim();
};

// Calculate price per base unit
const calculatePricePerUnit = (
  price: number,
  size: number | null,
  unit: string | null
): { pricePerUnit: number; displayUnit: string } | null => {
  if (!size || size <= 0) return null;

  const normalizedUnit = (unit || "un").toLowerCase();
  const conversion = unitConversions[normalizedUnit];

  if (!conversion) {
    return { pricePerUnit: price / size, displayUnit: unit || "un" };
  }

  const sizeInBaseUnit = size * conversion.factor;
  return {
    pricePerUnit: price / sizeInBaseUnit,
    displayUnit: conversion.base,
  };
};

export function PriceComparison({ items }: PriceComparisonProps) {
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [manualSelection, setManualSelection] = useState<string[]>([]);

  // Group products by normalized name
  const productGroups = useMemo(() => {
    const groups = new Map<string, PurchaseItemWithDetails[]>();

    items.forEach((item) => {
      // Only include items with package size defined
      if (item.package_size && item.package_size > 0) {
        const baseName = normalizeProductName(item.product_name);
        if (!groups.has(baseName)) {
          groups.set(baseName, []);
        }
        groups.get(baseName)!.push(item);
      }
    });

    // Only keep groups with more than one variant
    const result: ProductGroup[] = [];
    groups.forEach((variants, baseName) => {
      if (variants.length > 1) {
        result.push({ baseName, variants });
      }
    });

    return result.sort((a, b) => b.variants.length - a.variants.length);
  }, [items]);

  // Get comparison data for selected group
  const selectedComparison = useMemo((): ComparisonItem[] | null => {
    if (!selectedGroup) return null;

    const group = productGroups.find((g) => g.baseName === selectedGroup);
    if (!group) return null;

    const comparisons: ComparisonItem[] = [];
    group.variants.forEach((item) => {
      const calc = calculatePricePerUnit(item.unit_price, item.package_size, item.package_unit);
      if (calc) {
        comparisons.push({
          item,
          pricePerUnit: calc.pricePerUnit,
          displayUnit: calc.displayUnit,
        });
      }
    });

    return comparisons.sort((a, b) => a.pricePerUnit - b.pricePerUnit);
  }, [selectedGroup, productGroups]);

  // Manual comparison from selected items
  const manualComparison = useMemo((): ComparisonItem[] | null => {
    if (manualSelection.length < 2) return null;

    const selectedItems = items.filter((i) => manualSelection.includes(i.id));
    const comparisons: ComparisonItem[] = [];

    selectedItems.forEach((item) => {
      const calc = calculatePricePerUnit(item.unit_price, item.package_size, item.package_unit);
      if (calc) {
        comparisons.push({
          item,
          pricePerUnit: calc.pricePerUnit,
          displayUnit: calc.displayUnit,
        });
      }
    });

    return comparisons.sort((a, b) => a.pricePerUnit - b.pricePerUnit);
  }, [manualSelection, items]);

  const toggleManualSelection = (itemId: string) => {
    setManualSelection((prev) =>
      prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId]
    );
  };

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

  const itemsWithPackageInfo = items.filter((i) => i.package_size && i.package_size > 0);

  if (itemsWithPackageInfo.length === 0) {
    return (
      <Card className="card-elevated">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Scale className="h-5 w-5 text-primary" />
            Comparação de Preços
          </CardTitle>
          <CardDescription>Compare o custo-benefício entre embalagens diferentes</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p className="text-sm">
              Adicione produtos com tamanho da embalagem para comparar preços por unidade
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
          <Scale className="h-5 w-5 text-primary" />
          Comparação de Preços
        </CardTitle>
        <CardDescription>Veja qual embalagem tem o melhor custo-benefício</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Automatic Groups */}
        {productGroups.length > 0 && (
          <div className="space-y-3">
            <label className="text-sm font-medium">Comparação Automática</label>
            <Select
              value={selectedGroup || ""}
              onValueChange={(val) => {
                setSelectedGroup(val || null);
                setManualSelection([]);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione um produto para comparar" />
              </SelectTrigger>
              <SelectContent>
                {productGroups.map((group) => (
                  <SelectItem key={group.baseName} value={group.baseName}>
                    {group.baseName.charAt(0).toUpperCase() + group.baseName.slice(1)} ({group.variants.length} variações)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedComparison && selectedComparison.length > 0 && (
              <div className="space-y-2 mt-3">
                {selectedComparison.map((comp, index) => (
                  <div
                    key={comp.item.id}
                    className={`flex items-center justify-between p-3 rounded-xl ${
                      index === 0 ? "bg-primary/10 border-2 border-primary/30" : "bg-muted/50"
                    }`}
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{comp.item.product_name}</span>
                        {index === 0 && (
                          <Badge className="bg-primary/20 text-primary text-xs">
                            <TrendingDown className="h-3 w-3 mr-1" />
                            Melhor
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {comp.item.package_size}{comp.item.package_unit} • {comp.item.supermarket_name || "Loja"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`font-bold ${index === 0 ? "text-primary" : ""}`}>
                        {formatCurrency(comp.pricePerUnit)}/{comp.displayUnit}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatCurrency(comp.item.unit_price)}/un
                      </p>
                    </div>
                  </div>
                ))}

                {selectedComparison.length >= 2 && (
                  <div className="flex items-center gap-2 p-3 bg-accent/10 rounded-xl text-sm">
                    <TrendingDown className="h-4 w-4 text-accent" />
                    <span>
                      Economia de{" "}
                      <strong className="text-accent">
                        {(
                          ((selectedComparison[selectedComparison.length - 1].pricePerUnit -
                            selectedComparison[0].pricePerUnit) /
                            selectedComparison[selectedComparison.length - 1].pricePerUnit) *
                          100
                        ).toFixed(0)}
                        %
                      </strong>{" "}
                      escolhendo a melhor opção
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Divider */}
        {productGroups.length > 0 && (
          <div className="relative py-2">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">ou</span>
            </div>
          </div>
        )}

        {/* Manual Comparison */}
        <div className="space-y-3">
          <label className="text-sm font-medium">Comparação Manual</label>
          <p className="text-xs text-muted-foreground">
            Selecione 2 ou mais itens para comparar
          </p>
          <div className="max-h-48 overflow-y-auto space-y-2">
            {itemsWithPackageInfo.map((item) => {
              const isSelected = manualSelection.includes(item.id);
              return (
                <div
                  key={item.id}
                  className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors ${
                    isSelected ? "bg-primary/10" : "bg-muted/30 hover:bg-muted/50"
                  }`}
                  onClick={() => {
                    toggleManualSelection(item.id);
                    setSelectedGroup(null);
                  }}
                >
                  <div
                    className={`h-5 w-5 rounded border-2 flex items-center justify-center ${
                      isSelected ? "bg-primary border-primary" : "border-muted-foreground/30"
                    }`}
                  >
                    {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.product_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.package_size}{item.package_unit} • {formatCurrency(item.unit_price)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {manualComparison && manualComparison.length >= 2 && (
            <div className="space-y-2 mt-3 pt-3 border-t">
              <label className="text-sm font-medium">Resultado</label>
              {manualComparison.map((comp, index) => (
                <div
                  key={comp.item.id}
                  className={`flex items-center justify-between p-3 rounded-xl ${
                    index === 0 ? "bg-primary/10 border-2 border-primary/30" : "bg-muted/50"
                  }`}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{comp.item.product_name}</span>
                      {index === 0 && (
                        <Badge className="bg-primary/20 text-primary text-xs">Melhor</Badge>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`font-bold ${index === 0 ? "text-primary" : ""}`}>
                      {formatCurrency(comp.pricePerUnit)}/{comp.displayUnit}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
