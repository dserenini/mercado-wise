import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { QrCode, Link, FileText, Star, Loader2, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

export default function Leitor() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();

  const [nfcUrl, setNfcUrl] = useState("");
  const [scanning, setScanning] = useState(false);

  // Manual entry form state
  const [storeName, setStoreName] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [productName, setProductName] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [isPromotion, setIsPromotion] = useState(false);
  const [rating, setRating] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    }
  }, [user, authLoading, navigate]);

  const handleUrlSubmit = async () => {
    if (!nfcUrl.trim()) return;
    
    // Validate URL format (basic check for Sefaz MG pattern)
    const isValidUrl = nfcUrl.includes("sefaz.mg.gov.br") || nfcUrl.includes("nfce");
    
    if (!isValidUrl) {
      toast({
        title: "URL inválida",
        description: "Por favor, insira uma URL válida da NFC-e de Minas Gerais",
        variant: "destructive",
      });
      return;
    }

    setScanning(true);
    
    // Simulate processing (actual scraping will be done by external Python script)
    setTimeout(() => {
      toast({
        title: "URL recebida",
        description: "O processamento da nota será feito em background. Por enquanto, use a entrada manual.",
      });
      setScanning(false);
    }, 2000);
  };

  const handleManualSubmit = async () => {
    if (!user) return;
    if (!storeName.trim() || !productName.trim() || !unitPrice) {
      toast({
        title: "Campos obrigatórios",
        description: "Preencha loja, produto e preço",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);

    try {
      // Create purchase record
      const { data: purchase, error: purchaseError } = await supabase
        .from("purchase_history")
        .insert({
          user_id: user.id,
          supermarket_name: storeName.trim(),
          purchase_date: purchaseDate,
          total_amount: parseFloat(unitPrice) * parseFloat(quantity || "1"),
        })
        .select()
        .single();

      if (purchaseError) throw purchaseError;

      // Create purchase item
      const { error: itemError } = await supabase
        .from("purchase_items")
        .insert({
          purchase_id: purchase.id,
          product_name: productName.trim(),
          unit_price: parseFloat(unitPrice),
          quantity: parseFloat(quantity || "1"),
          total_price: parseFloat(unitPrice) * parseFloat(quantity || "1"),
          is_promotion: isPromotion,
          rating: rating > 0 ? rating : null,
        });

      if (itemError) throw itemError;

      // Add product to catalog if not exists
      await supabase.from("products").insert({
        name: productName.trim(),
      }).select().maybeSingle();

      // Add supermarket if not exists
      await supabase.from("supermarkets").insert({
        name: storeName.trim(),
      }).select().maybeSingle();

      toast({
        title: "Compra registrada!",
        description: "Os dados foram salvos com sucesso",
      });

      // Reset form
      setProductName("");
      setUnitPrice("");
      setQuantity("1");
      setIsPromotion(false);
      setRating(0);
    } catch (error: any) {
      toast({
        title: "Erro ao salvar",
        description: error.message,
        variant: "destructive",
      });
    }

    setSubmitting(false);
  };

  if (authLoading) {
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
          <h1 className="font-display font-bold text-2xl">Leitor de Notas</h1>
          <p className="text-muted-foreground text-sm">
            Escaneie ou adicione manualmente
          </p>
        </div>

        <Tabs defaultValue="scanner" className="space-y-6">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="scanner" className="gap-2">
              <QrCode className="h-4 w-4" />
              Scanner
            </TabsTrigger>
            <TabsTrigger value="manual" className="gap-2">
              <FileText className="h-4 w-4" />
              Manual
            </TabsTrigger>
          </TabsList>

          <TabsContent value="scanner" className="space-y-4">
            {/* QR Scanner Simulation */}
            <Card className="card-elevated">
              <CardContent className="p-6">
                <div className="aspect-square max-w-[280px] mx-auto bg-muted rounded-2xl flex flex-col items-center justify-center border-2 border-dashed border-border">
                  <QrCode className="h-16 w-16 text-muted-foreground mb-4" />
                  <p className="text-sm text-muted-foreground text-center px-4">
                    Scanner de QR Code será ativado em versão futura
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* URL Fallback */}
            <Card className="card-elevated">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Link className="h-5 w-5 text-primary" />
                  Cole a URL da NFC-e
                </CardTitle>
                <CardDescription>
                  Copie o link da nota fiscal do site da Sefaz MG
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                  <AlertCircle className="h-4 w-4 text-warning shrink-0" />
                  <p className="text-xs text-muted-foreground">
                    Apenas notas de Minas Gerais (Sefaz MG)
                  </p>
                </div>
                
                <Textarea
                  placeholder="https://nfce.fazenda.mg.gov.br/..."
                  value={nfcUrl}
                  onChange={(e) => setNfcUrl(e.target.value)}
                  className="min-h-[80px] touch-target"
                />
                
                <Button
                  onClick={handleUrlSubmit}
                  className="w-full touch-target"
                  disabled={scanning || !nfcUrl.trim()}
                >
                  {scanning ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin mr-2" />
                      Processando...
                    </>
                  ) : (
                    "Processar URL"
                  )}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="manual" className="space-y-4">
            <Card className="card-elevated">
              <CardHeader>
                <CardTitle className="text-base">Entrada Manual</CardTitle>
                <CardDescription>
                  Adicione os dados da compra manualmente
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2 space-y-2">
                    <Label>Nome da Loja</Label>
                    <Input
                      placeholder="Ex: Supermercado BH"
                      value={storeName}
                      onChange={(e) => setStoreName(e.target.value)}
                      className="touch-target"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Data</Label>
                    <Input
                      type="date"
                      value={purchaseDate}
                      onChange={(e) => setPurchaseDate(e.target.value)}
                      className="touch-target"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Quantidade</Label>
                    <Input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      className="touch-target"
                    />
                  </div>

                  <div className="col-span-2 space-y-2">
                    <Label>Nome do Produto</Label>
                    <Input
                      placeholder="Ex: Arroz 5kg"
                      value={productName}
                      onChange={(e) => setProductName(e.target.value)}
                      className="touch-target"
                    />
                  </div>

                  <div className="col-span-2 space-y-2">
                    <Label>Preço Unitário (R$)</Label>
                    <Input
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder="0,00"
                      value={unitPrice}
                      onChange={(e) => setUnitPrice(e.target.value)}
                      className="touch-target text-lg font-semibold"
                    />
                  </div>

                  <div className="col-span-2 flex items-center justify-between p-3 bg-muted rounded-lg">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">🏷️</span>
                      <span className="font-medium">Promoção?</span>
                    </div>
                    <Switch
                      checked={isPromotion}
                      onCheckedChange={setIsPromotion}
                    />
                  </div>

                  <div className="col-span-2 space-y-2">
                    <Label>Avaliação</Label>
                    <div className="flex gap-2">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          onClick={() => setRating(star)}
                          className="touch-target"
                        >
                          <Star
                            className={`h-8 w-8 transition-colors ${
                              star <= rating
                                ? "fill-warning text-warning"
                                : "text-muted-foreground"
                            }`}
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <Button
                  onClick={handleManualSubmit}
                  className="w-full touch-target text-base font-semibold"
                  disabled={submitting}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin mr-2" />
                      Salvando...
                    </>
                  ) : (
                    "Salvar Compra"
                  )}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
