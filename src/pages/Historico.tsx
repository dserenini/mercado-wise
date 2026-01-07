import { useState, useEffect, useMemo } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { Loader2, Receipt, Store, Calendar, Tag, Plus, Trash2, Filter, Pencil, X } from "lucide-react";
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
  isPromotion: boolean;
  packageSize: string;
  packageUnit: string;
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

  // Filter state
  const [filterSupermarket, setFilterSupermarket] = useState<string>("all");
  const [filterDateFrom, setFilterDateFrom] = useState<string>("");
  const [filterDateTo, setFilterDateTo] = useState<string>("");
  const [showFilters, setShowFilters] = useState(false);

  // Edit state
  const [editingPurchase, setEditingPurchase] = useState<Purchase | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [purchaseToDelete, setPurchaseToDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Manual purchase form state
  const [supermarketName, setSupermarketName] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().split("T")[0]);
  const [manualItems, setManualItems] = useState<ManualItem[]>([{ name: "", quantity: 1, unitPrice: 0, isPromotion: false, packageSize: "", packageUnit: "ml" }]);

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

  // Get unique supermarkets for filter
  const uniqueSupermarkets = useMemo(() => {
    const supermarkets = purchases
      .map((p) => p.supermarket_name)
      .filter((name): name is string => !!name);
    return [...new Set(supermarkets)];
  }, [purchases]);

  // Filter purchases
  const filteredPurchases = useMemo(() => {
    return purchases.filter((purchase) => {
      // Supermarket filter
      if (filterSupermarket !== "all" && purchase.supermarket_name !== filterSupermarket) {
        return false;
      }
      // Date from filter
      if (filterDateFrom && purchase.purchase_date < filterDateFrom) {
        return false;
      }
      // Date to filter
      if (filterDateTo && purchase.purchase_date > filterDateTo) {
        return false;
      }
      return true;
    });
  }, [purchases, filterSupermarket, filterDateFrom, filterDateTo]);

  const clearFilters = () => {
    setFilterSupermarket("all");
    setFilterDateFrom("");
    setFilterDateTo("");
  };

  const hasActiveFilters = filterSupermarket !== "all" || filterDateFrom || filterDateTo;

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
    setManualItems([...manualItems, { name: "", quantity: 1, unitPrice: 0, isPromotion: false, packageSize: "", packageUnit: "ml" }]);
  };

  const removeManualItem = (index: number) => {
    if (manualItems.length > 1) {
      setManualItems(manualItems.filter((_, i) => i !== index));
    }
  };

  const updateManualItem = (index: number, field: keyof ManualItem, value: string | number | boolean) => {
    const updated = [...manualItems];
    updated[index] = { ...updated[index], [field]: value };
    setManualItems(updated);
  };

  const resetForm = () => {
    setSupermarketName("");
    setPurchaseDate(new Date().toISOString().split("T")[0]);
    setManualItems([{ name: "", quantity: 1, unitPrice: 0, isPromotion: false, packageSize: "", packageUnit: "ml" }]);
    setEditingPurchase(null);
  };

  const handleEditPurchase = async (purchase: Purchase, e: React.MouseEvent) => {
    e.stopPropagation();
    
    // Fetch items if not already loaded
    let items = purchase.items;
    if (!items) {
      const { data } = await supabase
        .from("purchase_items")
        .select("*")
        .eq("purchase_id", purchase.id);
      items = data || [];
    }

    setEditingPurchase(purchase);
    setSupermarketName(purchase.supermarket_name || "");
    setPurchaseDate(purchase.purchase_date);
    setManualItems(
      items.length > 0
        ? items.map((item: any) => ({
            name: item.product_name,
            quantity: item.quantity || 1,
            unitPrice: item.unit_price,
            isPromotion: item.is_promotion || false,
            packageSize: item.package_size?.toString() || "",
            packageUnit: item.package_unit || "ml",
          }))
        : [{ name: "", quantity: 1, unitPrice: 0, isPromotion: false, packageSize: "", packageUnit: "ml" }]
    );
    setSheetOpen(true);
  };

  const handleDeleteClick = (purchaseId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPurchaseToDelete(purchaseId);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!purchaseToDelete) return;

    setDeleting(true);
    
    // Delete items first (due to foreign key)
    await supabase.from("purchase_items").delete().eq("purchase_id", purchaseToDelete);
    
    const { error } = await supabase
      .from("purchase_history")
      .delete()
      .eq("id", purchaseToDelete);

    if (error) {
      toast({
        title: "Erro ao excluir compra",
        description: error.message,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Compra excluída",
        description: "A compra foi removida com sucesso.",
      });
      fetchPurchases();
    }

    setDeleting(false);
    setDeleteDialogOpen(false);
    setPurchaseToDelete(null);
  };

  const handleSaveManualPurchase = async () => {
    if (!user) return;

    // Validação: Nome do supermercado obrigatório
    if (!supermarketName.trim()) {
      toast({
        title: "Nome do supermercado é obrigatório",
        variant: "destructive",
      });
      return;
    }

    // Validação: Data de compra válida (entre 01/01/2025 e hoje)
    const minDate = new Date("2025-01-01");
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    const selectedDate = new Date(purchaseDate);
    
    if (selectedDate < minDate) {
      toast({
        title: "Data inválida",
        description: "A data da compra deve ser a partir de 01/01/2025.",
        variant: "destructive",
      });
      return;
    }

    if (selectedDate > today) {
      toast({
        title: "Data inválida",
        description: "Não é permitido cadastrar compras com data no futuro.",
        variant: "destructive",
      });
      return;
    }

    const validItems = manualItems.filter((item) => item.name.trim() !== "");
    if (validItems.length === 0) {
      toast({
        title: "Adicione pelo menos um item",
        variant: "destructive",
      });
      return;
    }

    // Validação: Quantidade e preço dos itens
    for (const item of validItems) {
      if (item.quantity <= 0) {
        toast({
          title: "Quantidade inválida",
          description: `O item "${item.name}" deve ter quantidade maior que zero.`,
          variant: "destructive",
        });
        return;
      }
      if (item.unitPrice <= 0) {
        toast({
          title: "Preço inválido",
          description: `O item "${item.name}" deve ter preço unitário maior que zero.`,
          variant: "destructive",
        });
        return;
      }
    }

    setSaving(true);
    const totalAmount = validItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

    if (editingPurchase) {
      // Update existing purchase
      const { error: updateError } = await supabase
        .from("purchase_history")
        .update({
          supermarket_name: supermarketName || null,
          purchase_date: purchaseDate,
          total_amount: totalAmount,
        })
        .eq("id", editingPurchase.id);

      if (updateError) {
        toast({
          title: "Erro ao atualizar compra",
          description: updateError.message,
          variant: "destructive",
        });
        setSaving(false);
        return;
      }

      // Soft delete old items (inactivate) instead of hard delete
      await supabase
        .from("purchase_items")
        .update({ is_active: false })
        .eq("purchase_id", editingPurchase.id);

      const itemsToInsert = validItems.map((item) => ({
        purchase_id: editingPurchase.id,
        product_name: item.name,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        total_price: item.quantity * item.unitPrice,
        is_promotion: item.isPromotion,
        package_size: item.packageSize ? parseFloat(item.packageSize) : null,
        package_unit: item.packageUnit || null,
      }));

      const { error: itemsError } = await supabase.from("purchase_items").insert(itemsToInsert);

      if (itemsError) {
        toast({
          title: "Erro ao atualizar itens",
          description: itemsError.message,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Compra atualizada!",
          description: `${validItems.length} itens salvos com sucesso.`,
        });
        resetForm();
        setSheetOpen(false);
        fetchPurchases();
      }
    } else {
      // Create new purchase
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
        is_promotion: item.isPromotion,
        package_size: item.packageSize ? parseFloat(item.packageSize) : null,
        package_unit: item.packageUnit || null,
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
              {filteredPurchases.length} {filteredPurchases.length === 1 ? "compra" : "compras"} 
              {hasActiveFilters && " (filtrado)"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={showFilters ? "secondary" : "outline"}
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
              className="gap-2"
            >
              <Filter className="h-4 w-4" />
              {hasActiveFilters && (
                <Badge variant="secondary" className="h-5 w-5 p-0 flex items-center justify-center text-xs">
                  !
                </Badge>
              )}
            </Button>
            <Sheet open={sheetOpen} onOpenChange={(open) => {
              setSheetOpen(open);
              if (!open) resetForm();
            }}>
              <SheetTrigger asChild>
                <Button size="sm" className="gap-2">
                  <Plus className="h-4 w-4" />
                  Adicionar
                </Button>
              </SheetTrigger>
              <SheetContent side="bottom" className="h-[85vh] overflow-y-auto">
                <SheetHeader className="mb-4">
                  <SheetTitle>{editingPurchase ? "Editar Compra" : "Nova Compra Manual"}</SheetTitle>
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
                      min="2025-01-01"
                      max={new Date().toISOString().split("T")[0]}
                    />
                  </div>

                  <div className="space-y-3">
                    <Label>Itens</Label>
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
                              min="0.01"
                              step="0.01"
                              value={item.quantity}
                              onChange={(e) => updateManualItem(index, "quantity", Number(e.target.value))}
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Preço unitário (R$)</Label>
                            <Input
                              type="number"
                              step="0.01"
                              min="0.01"
                              value={item.unitPrice}
                              onChange={(e) => updateManualItem(index, "unitPrice", Number(e.target.value))}
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <Label className="text-xs">Tamanho emb.</Label>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="Ex: 473"
                              value={item.packageSize}
                              onChange={(e) => updateManualItem(index, "packageSize", e.target.value)}
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Unidade</Label>
                            <Select
                              value={item.packageUnit}
                              onValueChange={(val) => updateManualItem(index, "packageUnit", val)}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="ml">ml</SelectItem>
                                <SelectItem value="l">L</SelectItem>
                                <SelectItem value="g">g</SelectItem>
                                <SelectItem value="kg">kg</SelectItem>
                                <SelectItem value="un">un</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="flex items-center justify-between pt-2">
                          <div className="flex items-center gap-2">
                            <Tag className="h-4 w-4 text-primary" />
                            <span className="text-sm">Promoção</span>
                          </div>
                          <Switch
                            checked={item.isPromotion}
                            onCheckedChange={(checked) => updateManualItem(index, "isPromotion", checked)}
                          />
                        </div>
                      </div>
                    ))}
                    <Button type="button" variant="outline" size="sm" onClick={addManualItem} className="w-full">
                      <Plus className="h-4 w-4 mr-1" />
                      Adicionar Item
                    </Button>
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
                      ) : editingPurchase ? (
                        "Atualizar Compra"
                      ) : (
                        "Salvar Compra"
                      )}
                    </Button>
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>

        {/* Filters Section */}
        {showFilters && (
          <Card className="mb-4 card-elevated">
            <CardContent className="pt-4 space-y-4">
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">Filtros</span>
                {hasActiveFilters && (
                  <Button variant="ghost" size="sm" onClick={clearFilters} className="text-xs gap-1">
                    <X className="h-3 w-3" />
                    Limpar
                  </Button>
                )}
              </div>
              <div className="grid gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Supermercado</Label>
                  <Select value={filterSupermarket} onValueChange={setFilterSupermarket}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Todos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      {uniqueSupermarkets.map((supermarket) => (
                        <SelectItem key={supermarket} value={supermarket}>
                          {supermarket}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs text-muted-foreground">Data inicial</Label>
                    <Input
                      type="date"
                      value={filterDateFrom}
                      onChange={(e) => setFilterDateFrom(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Data final</Label>
                    <Input
                      type="date"
                      value={filterDateTo}
                      onChange={(e) => setFilterDateTo(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {filteredPurchases.length === 0 ? (
          <Card className="card-elevated">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Receipt className="h-16 w-16 text-muted-foreground mb-4" />
              <h3 className="font-display font-semibold text-lg mb-2">
                {hasActiveFilters ? "Nenhuma compra encontrada" : "Nenhuma compra registrada"}
              </h3>
              <p className="text-muted-foreground text-center">
                {hasActiveFilters
                  ? "Tente ajustar os filtros"
                  : "Use o Leitor para adicionar suas compras"}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredPurchases.map((purchase) => (
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
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => handleEditPurchase(purchase, e)}
                        className="h-8 w-8 p-0"
                      >
                        <Pencil className="h-4 w-4 text-muted-foreground" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => handleDeleteClick(purchase.id, e)}
                        className="h-8 w-8 p-0"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                      {purchase.total_amount && (
                        <span className="font-display font-bold text-lg text-primary ml-2">
                          {formatCurrency(purchase.total_amount)}
                        </span>
                      )}
                    </div>
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

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir compra?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. A compra e todos os seus itens serão removidos permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Excluindo...
                </>
              ) : (
                "Excluir"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
