import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Loader2, Receipt, Store, Calendar, Tag, Plus, Trash2 } from "lucide-react";
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

interface ManualItem {
  name: string;
  quantity: number;
  unitPrice: number;
}

export default function Historico() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();

  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Manual purchase form state
  const [supermarketName, setSupermarketName] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().split("T")[0]);
  const [manualItems, setManualItems] = useState<ManualItem[]>([{ name: "", quantity: 1, unitPrice: 0 }]);

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

  const addManualItem = () => {
    setManualItems([...manualItems, { name: "", quantity: 1, unitPrice: 0 }]);
  };

  const removeManualItem = (index: number) => {
    if (manualItems.length > 1) {
      setManualItems(manualItems.filter((_, i) => i !== index));
    }
  };

  const updateManualItem = (index: number, field: keyof ManualItem, value: string | number) => {
    const updated = [...manualItems];
    updated[index] = { ...updated[index], [field]: value };
    setManualItems(updated);
  };

  const resetForm = () => {
    setSupermarketName("");
    setPurchaseDate(new Date().toISOString().split("T")[0]);
    setManualItems([{ name: "", quantity: 1, unitPrice: 0 }]);
  };

  const handleSaveManualPurchase = async () => {
    if (!user) return;

    const validItems = manualItems.filter((item) => item.name.trim() !== "");
    if (validItems.length === 0) {
      toast({
        title: "Adicione pelo menos um item",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    const totalAmount = validItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

    const { data: purchaseData, error: purchaseError } = await supabase
      .from("purchase_history")
      .insert({
        user_id: user.id,
        supermarket_name: supermarketName || null,
        purchase_date: purchaseDate,
        total_amount: totalAmount,
      })
      .select()
      .single();

    if (purchaseError) {
      toast({
        title: "Erro ao salvar compra",
        description: purchaseError.message,
        variant: "destructive",
      });
      setSaving(false);
      return;
    }

    const itemsToInsert = validItems.map((item) => ({
      purchase_id: purchaseData.id,
      product_name: item.name,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      total_price: item.quantity * item.unitPrice,
    }));

    const { error: itemsError } = await supabase.from("purchase_items").insert(itemsToInsert);

    if (itemsError) {
      toast({
        title: "Erro ao salvar itens",
        description: itemsError.message,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Compra adicionada!",
        description: `${validItems.length} itens salvos com sucesso.`,
      });
      resetForm();
      setSheetOpen(false);
      fetchPurchases();
    }
    setSaving(false);
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
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="font-display font-bold text-2xl">Histórico</h1>
            <p className="text-muted-foreground text-sm">
              {purchases.length} {purchases.length === 1 ? "compra" : "compras"} registradas
            </p>
          </div>
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <Button size="sm" className="gap-2">
                <Plus className="h-4 w-4" />
                Adicionar
              </Button>
            </SheetTrigger>
            <SheetContent side="bottom" className="h-[85vh] overflow-y-auto">
              <SheetHeader className="mb-4">
                <SheetTitle>Nova Compra Manual</SheetTitle>
              </SheetHeader>
              <div className="space-y-4">
                <div className="grid gap-2">
                  <Label htmlFor="supermarket">Supermercado</Label>
                  <Input
                    id="supermarket"
                    placeholder="Nome do supermercado"
                    value={supermarketName}
                    onChange={(e) => setSupermarketName(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="date">Data da compra</Label>
                  <Input
                    id="date"
                    type="date"
                    value={purchaseDate}
                    onChange={(e) => setPurchaseDate(e.target.value)}
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Itens</Label>
                    <Button type="button" variant="outline" size="sm" onClick={addManualItem}>
                      <Plus className="h-4 w-4 mr-1" />
                      Item
                    </Button>
                  </div>
                  {manualItems.map((item, index) => (
                    <div key={index} className="p-3 bg-muted/50 rounded-xl space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Item {index + 1}</span>
                        {manualItems.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeManualItem(index)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                      <Input
                        placeholder="Nome do produto"
                        value={item.name}
                        onChange={(e) => updateManualItem(index, "name", e.target.value)}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-xs">Quantidade</Label>
                          <Input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={(e) => updateManualItem(index, "quantity", Number(e.target.value))}
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Preço unitário</Label>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={item.unitPrice}
                            onChange={(e) => updateManualItem(index, "unitPrice", Number(e.target.value))}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="pt-4 border-t">
                  <div className="flex justify-between items-center mb-4">
                    <span className="font-semibold">Total:</span>
                    <span className="font-display font-bold text-xl text-primary">
                      {formatCurrency(
                        manualItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
                      )}
                    </span>
                  </div>
                  <Button
                    className="w-full"
                    onClick={handleSaveManualPurchase}
                    disabled={saving}
                  >
                    {saving ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Salvando...
                      </>
                    ) : (
                      "Salvar Compra"
                    )}
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>
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
