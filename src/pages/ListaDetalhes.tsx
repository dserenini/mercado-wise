import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { ArrowLeft, Plus, Check, Trash2, Loader2, Circle, GripVertical, MoreVertical, Minus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface ListItem {
  id: string;
  list_id: string;
  product_name: string;
  is_checked: boolean;
  quantity: number | null;
  unit: string | null;
  position: number | null;
}

interface ShoppingList {
  id: string;
  name: string;
  is_active: boolean;
}

interface SortableItemProps {
  item: ListItem;
  toggleItemCheck: (item: ListItem) => void;
  deleteItem: (id: string) => void;
  updateQuantity: (id: string, delta: number) => void;
}

function SortableItem({ item, toggleItemCheck, deleteItem, updateQuantity }: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 1 : 0,
  };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={`relative transition-colors duration-200 ${item.is_checked ? 'opacity-60 bg-muted/50' : 'card-elevated hover:shadow-md'} ${isDragging ? 'shadow-xl ring-2 ring-primary/20 opacity-90' : ''}`}
    >
      <CardContent className="p-3">
        <div className="flex items-center gap-2">
          {/* Drag Handle */}
          <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing p-1 text-muted-foreground hover:text-foreground touch-none shrink-0">
            <GripVertical className="h-5 w-5" />
          </div>

          {/* Check Toggle */}
          <div 
            className="flex-1 flex items-center gap-3 cursor-pointer py-1 min-w-0"
            onClick={() => toggleItemCheck(item)}
          >
            <div className={`p-1 rounded-full shrink-0 transition-colors ${item.is_checked ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
              {item.is_checked ? <Check className="h-5 w-5" /> : <Circle className="h-5 w-5" />}
            </div>
            <span className={`text-base font-medium truncate transition-all ${item.is_checked ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
              {item.product_name}
            </span>
          </div>

          {/* Quantity Controls */}
          <div className="flex items-center gap-1 shrink-0 bg-muted/30 rounded-lg p-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-sm"
              onClick={() => updateQuantity(item.id, -1)}
            >
              <Minus className="h-3 w-3" />
            </Button>
            <span className="text-sm font-medium w-6 text-center">{item.quantity ?? 1}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-sm"
              onClick={() => updateQuantity(item.id, 1)}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>

          {/* Delete Button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => deleteItem(item.id)}
            className="text-muted-foreground hover:text-destructive shrink-0 ml-1"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ListaDetalhes() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();
  
  const [list, setList] = useState<ShoppingList | null>(null);
  const [items, setItems] = useState<ListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newItemName, setNewItemName] = useState("");
  const [addingItem, setAddingItem] = useState(false);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require dragging a bit before activation so clicks still work easily
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    if (user && id) {
      fetchListAndItems();
    }
  }, [user, id]);

  const fetchListAndItems = async () => {
    if (!id) return;
    try {
      const { data: listData, error: listError } = await supabase
        .from("shopping_lists")
        .select("*")
        .eq("id", id)
        .single();
        
      if (listError) throw listError;
      setList(listData);

      const { data: itemsData, error: itemsError } = await supabase
        .from("list_items")
        .select("*")
        .eq("list_id", id)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true }); // Fallback sorting

      if (itemsError) throw itemsError;
      setItems(itemsData || []);
    } catch (error: any) {
      toast({
        title: "Erro ao carregar lista",
        description: error.message,
        variant: "destructive",
      });
      navigate("/listas");
    } finally {
      setLoading(false);
    }
  };

  const addItem = async () => {
    if (!newItemName.trim() || !user || !id) return;
    setAddingItem(true);
    
    // Assign position to the bottom of the list
    const newPosition = items.length > 0 ? (items[items.length - 1].position || 0) + 1 : 0;

    try {
      const { data, error } = await supabase
        .from("list_items")
        .insert({
          list_id: id,
          product_name: newItemName.trim(),
          is_checked: false,
          quantity: 1,
          position: newPosition
        })
        .select()
        .single();

      if (error) throw error;
      
      setItems([...items, data]);
      setNewItemName("");
    } catch (error: any) {
      toast({
        title: "Erro ao adicionar item",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setAddingItem(false);
    }
  };

  const toggleItemCheck = async (item: ListItem) => {
    const newCheckedState = !item.is_checked;
    setItems(items.map(i => i.id === item.id ? { ...i, is_checked: newCheckedState } : i));
    
    try {
      const { error } = await supabase
        .from("list_items")
        .update({ is_checked: newCheckedState })
        .eq("id", item.id);

      if (error) throw error;
    } catch (error: any) {
      fetchListAndItems();
      toast({
        title: "Erro ao atualizar item",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const updateQuantity = async (itemId: string, delta: number) => {
    const item = items.find(i => i.id === itemId);
    if (!item) return;

    const newQuantity = Math.max(1, (item.quantity || 1) + delta);
    setItems(items.map(i => i.id === itemId ? { ...i, quantity: newQuantity } : i));

    try {
      const { error } = await supabase
        .from("list_items")
        .update({ quantity: newQuantity })
        .eq("id", itemId);

      if (error) throw error;
    } catch (error: any) {
      toast({
        title: "Erro ao atualizar quantidade",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const deleteItem = async (itemId: string) => {
    setItems(items.filter(i => i.id !== itemId));
    try {
      const { error } = await supabase
        .from("list_items")
        .delete()
        .eq("id", itemId);

      if (error) throw error;
    } catch (error: any) {
      toast({
        title: "Erro ao remover item",
        description: error.message,
        variant: "destructive",
      });
      fetchListAndItems();
    }
  };

  const clearList = async () => {
    if (!id || items.length === 0) return;
    setItems([]);
    
    try {
      const { error } = await supabase
        .from("list_items")
        .delete()
        .eq("list_id", id);

      if (error) throw error;
      toast({ title: "Lista limpa!" });
    } catch (error: any) {
      fetchListAndItems();
      toast({
        title: "Erro ao limpar lista",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const finishList = async () => {
    if (!id) return;
    try {
      const { error } = await supabase
        .from("shopping_lists")
        .update({ is_active: false })
        .eq("id", id);

      if (error) throw error;
      toast({ title: "Lista finalizada com sucesso!" });
      navigate("/listas");
    } catch (error: any) {
      toast({
        title: "Erro ao finalizar lista",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (over && active.id !== over.id) {
      const oldIndex = items.findIndex((item) => item.id === active.id);
      const newIndex = items.findIndex((item) => item.id === over.id);
      
      const newlyAutosorted = arrayMove(items, oldIndex, newIndex);
      setItems(newlyAutosorted);

      // Save new positions to the backend
      try {
        const updates = newlyAutosorted.map((item, idx) => ({
          id: item.id,
          position: idx
        }));

        // Supabase bulk updates can be tricky, we'll map an async Promise.all for now
        // since usually lists aren't massive.
        await Promise.all(
          updates.map((update) =>
            supabase
              .from("list_items")
              .update({ position: update.position })
              .eq("id", update.id)
          )
        );
      } catch (error: any) {
        toast({
          title: "Erro ao salvar ordem",
          description: "Não foi possível sincronizar a nova ordem.",
          variant: "destructive",
        });
      }
    }
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

  if (!list) return null;

  return (
    <AppLayout>
      <div className="container px-4 py-6 animate-fade-in max-w-2xl mx-auto">
        <div className="flex items-center gap-2 mb-6 justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/listas")} className="shrink-0 -ml-2">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="font-display font-bold text-2xl tracking-tight">{list.name}</h1>
              <p className="text-muted-foreground text-sm">
                {items.filter(i => i.is_checked).length} de {items.length} itens marcados
              </p>
            </div>
          </div>
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="shrink-0 touch-target">
                <MoreVertical className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={finishList} className="cursor-pointer font-medium p-3">
                <Check className="h-4 w-4 mr-2 text-primary" />
                Finalizar Lista
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={clearList} className="cursor-pointer text-destructive focus:text-destructive p-3">
                <Trash2 className="h-4 w-4 mr-2" />
                Limpar Toda a Lista
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex gap-2 mb-6">
          <Input
            placeholder="Adicionar novo item..."
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addItem()}
            className="touch-target flex-1"
          />
          <Button
            onClick={addItem}
            disabled={addingItem || !newItemName.trim()}
            className="touch-target px-4"
          >
            {addingItem ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
          </Button>
        </div>

        <DndContext 
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <div className="space-y-2 pb-24">
            <SortableContext 
              items={items.map(item => item.id)}
              strategy={verticalListSortingStrategy}
            >
              {items.map((item) => (
                <SortableItem
                  key={item.id}
                  item={item}
                  toggleItemCheck={toggleItemCheck}
                  deleteItem={deleteItem}
                  updateQuantity={updateQuantity}
                />
              ))}
            </SortableContext>

            {items.length === 0 && (
              <div className="text-center py-12 text-muted-foreground border-2 border-dashed border-muted rounded-xl bg-muted/20">
                <p>Sua lista está vazia.</p>
                <p className="text-sm">Adicione itens no campo acima</p>
              </div>
            )}
          </div>
        </DndContext>
      </div>
    </AppLayout>
  );
}
