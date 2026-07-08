import { useEffect, useMemo, useRef, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/hooks/useAuth";
import { usePurchasesWithItems } from "@/hooks/queries/usePurchases";
import { usePriceObservations, useSaveObservation } from "@/hooks/queries/usePriceObservations";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Barcode, Camera, X, Check, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  computeBenchmarks,
  distinctConcepts,
  guessConcept,
  priceVerdict,
  formatCurrency,
  type AnalyticsItem,
} from "@/lib/analytics";

const LAST_MARKET_KEY = "mf:lastMarket";

interface ResolvedProduct {
  gtin: string;
  name: string | null;
  brand: string | null;
  package_size: number | null;
  package_unit: string | null;
  source: string | null;
}

export default function Scanner() {
  const { session, user } = useAuth();
  const { toast } = useToast();
  const { data: purchases = [] } = usePurchasesWithItems();
  const { data: observations = [] } = usePriceObservations();
  const saveObservation = useSaveObservation();

  const [gtinInput, setGtinInput] = useState("");
  const [resolving, setResolving] = useState(false);
  const [product, setProduct] = useState<ResolvedProduct | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [concept, setConcept] = useState<string>("");
  const [market, setMarket] = useState<string>(() => localStorage.getItem(LAST_MARKET_KEY) || "");
  const [price, setPrice] = useState<string>("");
  const [cameraOn, setCameraOn] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const cameraSupported = typeof window !== "undefined" && !!window.BarcodeDetector;

  // Todos os itens (compras + observações) achatados para os benchmarks/conceitos
  const analyticsItems = useMemo<AnalyticsItem[]>(() => {
    const items: AnalyticsItem[] = [];
    purchases.forEach((p) => {
      (p.purchase_items ?? []).forEach((it) => {
        items.push({
          product_name: it.product_name,
          unit_price: it.unit_price,
          quantity: it.quantity || 1,
          package_size: it.package_size,
          package_unit: it.package_unit,
          purchase_date: p.purchase_date,
          supermarket_name: p.supermarket_name,
        });
      });
    });
    observations.forEach((o) => {
      items.push({
        product_name: o.product_name,
        unit_price: o.price,
        quantity: 1,
        package_size: o.package_size,
        package_unit: o.package_unit,
        purchase_date: o.observed_at,
        supermarket_name: o.supermarket_name,
      });
    });
    return items;
  }, [purchases, observations]);

  const benchmarks = useMemo(() => computeBenchmarks(analyticsItems), [analyticsItems]);
  const concepts = useMemo(() => distinctConcepts(analyticsItems), [analyticsItems]);
  const markets = useMemo(() => {
    const set = new Set<string>();
    purchases.forEach((p) => p.supermarket_name && set.add(p.supermarket_name));
    observations.forEach((o) => o.supermarket_name && set.add(o.supermarket_name));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [purchases, observations]);

  const stopCamera = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  };

  // Limpeza ao desmontar
  useEffect(() => () => stopCamera(), []);

  const resolveGtin = async (gtin: string) => {
    if (!session?.access_token) {
      toast({ title: "Sessão expirada", description: "Faça login novamente.", variant: "destructive" });
      return;
    }
    setResolving(true);
    setProduct(null);
    setNotFound(false);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:8000";
      const resp = await fetch(`${apiUrl}/produto/${gtin}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail || `Erro HTTP ${resp.status}`);
      }
      const data = await resp.json();
      const p: ResolvedProduct = data.produto;
      setProduct(p);
      if (data.found && p.name) {
        setConcept(guessConcept(p.name, concepts) || p.name);
      } else {
        setNotFound(true);
        setConcept("");
      }
    } catch (e) {
      toast({ title: "Erro ao consultar produto", description: (e as Error).message, variant: "destructive" });
    } finally {
      setResolving(false);
    }
  };

  const handleDetected = (raw: string) => {
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 8) return;
    stopCamera();
    setGtinInput(digits);
    resolveGtin(digits);
  };

  const startCamera = async () => {
    if (!cameraSupported || !window.BarcodeDetector) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      setCameraOn(true);
      const detector = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] });
      // aguarda o vídeo montar
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => undefined);
        }
      });
      const tick = async () => {
        if (!videoRef.current || !streamRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes.length > 0) {
            handleDetected(codes[0].rawValue);
            return;
          }
        } catch {
          /* frame não pronto — ignora */
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      toast({ title: "Câmera indisponível", description: "Digite o código manualmente.", variant: "destructive" });
      setCameraOn(false);
    }
  };

  const priceNum = parseFloat(price.replace(",", "."));
  const scanItem: AnalyticsItem | null =
    concept && priceNum > 0
      ? {
          product_name: concept,
          unit_price: priceNum,
          quantity: 1,
          package_size: product?.package_size ?? null,
          package_unit: product?.package_unit ?? null,
          purchase_date: new Date().toISOString().slice(0, 10),
          supermarket_name: market || null,
        }
      : null;

  const verdict = scanItem ? priceVerdict(scanItem, benchmarks) : null;

  const handleSave = () => {
    if (!user || !scanItem) return;
    if (market) localStorage.setItem(LAST_MARKET_KEY, market);
    saveObservation.mutate(
      {
        userId: user.id,
        gtin: product?.gtin || (gtinInput || null),
        product_name: concept,
        brand: product?.brand ?? null,
        supermarket_name: market || null,
        price: priceNum,
        package_size: product?.package_size ?? null,
        package_unit: product?.package_unit ?? null,
      },
      {
        onSuccess: () => {
          toast({ title: "Preço registrado! ✅", description: "Isso melhora suas médias." });
          setProduct(null);
          setNotFound(false);
          setConcept("");
          setPrice("");
          setGtinInput("");
        },
        onError: (err) =>
          toast({ title: "Erro ao salvar", description: (err as Error).message, variant: "destructive" }),
      },
    );
  };

  return (
    <AppLayout>
      <div className="container px-4 py-6 animate-fade-in pb-24">
        <div className="mb-6">
          <h1 className="font-display font-bold text-2xl">Esse preço tá bom?</h1>
          <p className="text-muted-foreground text-sm">
            Escaneie o código de barras na gôndola e compare com a sua média
          </p>
        </div>

        {/* Captura do código */}
        <Card className="card-elevated mb-4">
          <CardContent className="p-4 space-y-3">
            {cameraOn ? (
              <div className="space-y-3">
                <div className="relative aspect-[3/4] max-w-[320px] mx-auto rounded-xl overflow-hidden bg-black">
                  <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
                  <div className="absolute inset-x-6 top-1/2 h-0.5 bg-primary/80 shadow-[0_0_8px_hsl(var(--primary))]" />
                  <Button
                    size="icon"
                    variant="destructive"
                    className="absolute top-2 right-2 h-8 w-8 rounded-full"
                    onClick={stopCamera}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground text-center">Aponte para o código de barras</p>
              </div>
            ) : (
              <div className="space-y-3">
                {cameraSupported && (
                  <Button variant="outline" className="w-full h-12 gap-2" onClick={startCamera}>
                    <Camera className="h-5 w-5" />
                    Escanear com a câmera
                  </Button>
                )}
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Label className="text-xs text-muted-foreground">Ou digite o código de barras</Label>
                    <Input
                      inputMode="numeric"
                      placeholder="7891000100103"
                      value={gtinInput}
                      onChange={(e) => setGtinInput(e.target.value.replace(/\D/g, ""))}
                    />
                  </div>
                  <Button
                    onClick={() => resolveGtin(gtinInput)}
                    disabled={gtinInput.length < 8 || resolving}
                  >
                    {resolving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Barcode className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Produto resolvido + veredito */}
        {(product || resolving) && (
          <Card className="card-elevated">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {resolving ? "Consultando..." : product?.name || "Produto não identificado"}
              </CardTitle>
              {product?.brand && <CardDescription>{product.brand}</CardDescription>}
              {product?.package_size && (
                <CardDescription>
                  Embalagem: {product.package_size}
                  {product.package_unit}
                </CardDescription>
              )}
            </CardHeader>

            {!resolving && (
              <CardContent className="space-y-4">
                {notFound && (
                  <p className="text-xs text-muted-foreground">
                    Não achamos esse código na base pública. Escolha o produto correspondente ou
                    registre com o nome que preferir.
                  </p>
                )}

                {/* Conceito correspondente no histórico */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Produto (no seu histórico)</Label>
                  {concepts.length > 0 ? (
                    <Select value={concept} onValueChange={setConcept}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o produto" />
                      </SelectTrigger>
                      <SelectContent>
                        {product?.name && !concepts.includes(product.name) && (
                          <SelectItem value={product.name}>{product.name} (novo)</SelectItem>
                        )}
                        {concepts.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      placeholder="Nome do produto"
                      value={concept}
                      onChange={(e) => setConcept(e.target.value)}
                    />
                  )}
                </div>

                {/* Mercado */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Mercado</Label>
                  <Input
                    list="mf-markets"
                    placeholder="Onde você está?"
                    value={market}
                    onChange={(e) => setMarket(e.target.value)}
                  />
                  <datalist id="mf-markets">
                    {markets.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </div>

                {/* Preço */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Preço na gôndola (R$)</Label>
                  <Input
                    inputMode="decimal"
                    placeholder="0,00"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                  />
                </div>

                {/* Veredito */}
                {verdict && verdict.verdict !== "unknown" && (
                  <VerdictBanner
                    verdict={verdict.verdict}
                    deltaPct={verdict.deltaPct}
                    avg={verdict.avg}
                    unit={verdict.unit}
                  />
                )}
                {verdict && verdict.verdict === "unknown" && (
                  <p className="text-xs text-muted-foreground">
                    Ainda não há histórico suficiente desse produto para dar um veredito — mas seu
                    registro já começa a construir a média.
                  </p>
                )}

                <Button
                  className="w-full"
                  onClick={handleSave}
                  disabled={!concept || !(priceNum > 0) || saveObservation.isPending}
                >
                  {saveObservation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Check className="h-4 w-4 mr-2" />
                  )}
                  Registrar preço
                </Button>
              </CardContent>
            )}
          </Card>
        )}
      </div>
    </AppLayout>
  );
}

function VerdictBanner({
  verdict,
  deltaPct,
  avg,
  unit,
}: {
  verdict: "below" | "average" | "above";
  deltaPct: number;
  avg: number;
  unit: string;
}) {
  const config = {
    below: {
      icon: TrendingDown,
      color: "hsl(var(--price-good))",
      title: `${Math.abs(deltaPct).toFixed(0)}% abaixo da sua média`,
      subtitle: "Boa oportunidade! 🎉",
    },
    above: {
      icon: TrendingUp,
      color: "hsl(var(--price-expensive))",
      title: `${deltaPct.toFixed(0)}% acima da sua média`,
      subtitle: "Talvez valha esperar ou comprar em outro lugar.",
    },
    average: {
      icon: Minus,
      color: "hsl(var(--price-neutral))",
      title: "Na sua média",
      subtitle: "Preço dentro do que você costuma pagar.",
    },
  }[verdict];

  const Icon = config.icon;
  return (
    <div
      className="flex items-center gap-3 p-3 rounded-xl"
      style={{ backgroundColor: `${config.color}1a` }}
    >
      <Icon className="h-6 w-6 shrink-0" style={{ color: config.color }} />
      <div className="min-w-0">
        <p className="font-semibold text-sm" style={{ color: config.color }}>
          {config.title}
        </p>
        <p className="text-xs text-muted-foreground">
          {config.subtitle} Sua média: {formatCurrency(avg)}/{unit}
        </p>
      </div>
    </div>
  );
}
