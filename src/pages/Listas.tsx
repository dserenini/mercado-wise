import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, ShoppingCart, Check, Trash2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ShoppingList {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  item_count?: number;
}

export default function Listas() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();
  
  const [lists, setLists] = useState<ShoppingList[]>([]);
  const [loading, setLoading] = useState(true);
  const [newListName, setNewListName] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (user) {
      fetchLists();
    }
  }, [user]);

  const fetchLists = async () => {
    const { data, error } = await supabase
      .from("shopping_lists")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      toast({
        title: "Erro ao carregar listas",
        description: error.message,
        variant: "destructive",
      });
    } else {
      setLists(data || []);
    }
    setLoading(false);
  };

  const createList = async () => {
    if (!newListName.trim() || !user) return;
    
    setCreating(true);
    const { error } = await supabase.from("shopping_lists").insert({
      name: newListName.trim(),
      user_id: user.id,
    });

    if (error) {
      toast({
        title: "Erro ao criar lista",
        description: error.message,
        variant: "destructive",
      });
    } else {
      toast({ title: "Lista criada!" });
      setNewListName("");
      setDialogOpen(false);
      fetchLists();
    }
    setCreating(false);
  };

  const deleteList = async (id: string) => {
    const { error } = await supabase.from("shopping_lists").delete().eq("id", id);
    
    if (error) {
      toast({
        title: "Erro ao excluir lista",
        description: error.message,
        variant: "destructive",
      });
    } else {
      toast({ title: "Lista excluída" });
      fetchLists();
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

  return (
    <AppLayout>
      <div className="container px-4 py-6 animate-fade-in">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display font-bold text-2xl">Minhas Listas</h1>
            <p className="text-muted-foreground text-sm">
              {lists.length} {lists.length === 1 ? "lista" : "listas"}
            </p>
          </div>

          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="touch-target rounded-xl gap-2">
                <Plus className="h-5 w-5" />
                Nova Lista
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Criar nova lista</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <Input
                  placeholder="Nome da lista"
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                  className="touch-target"
                  onKeyDown={(e) => e.key === "Enter" && createList()}
                />
                <Button
                  onClick={createList}
                  className="w-full touch-target"
                  disabled={creating || !newListName.trim()}
                >
                  {creating ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : null}
                  Criar Lista
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {lists.length === 0 ? (
          <Card className="card-elevated">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <ShoppingCart className="h-16 w-16 text-muted-foreground mb-4" />
              <h3 className="font-display font-semibold text-lg mb-2">
                Nenhuma lista ainda
              </h3>
              <p className="text-muted-foreground text-center mb-4">
                Crie sua primeira lista de compras
              </p>
              <Button onClick={() => setDialogOpen(true)} className="touch-target">
                <Plus className="h-5 w-5 mr-2" />
                Criar Lista
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {lists.map((list) => (
              <Card
                key={list.id}
                onClick={() => navigate(`/listas/${list.id}`)}
                className="card-elevated cursor-pointer hover:shadow-xl transition-all duration-200 active:scale-[0.98]"
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-xl ${list.is_active ? "bg-primary/10" : "bg-muted"}`}>
                        {list.is_active ? (
                          <ShoppingCart className="h-5 w-5 text-primary" />
                        ) : (
                          <Check className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                      <div>
                        <CardTitle className="text-base">{list.name}</CardTitle>
                        <p className="text-xs text-muted-foreground">
                          {new Date(list.created_at).toLocaleDateString("pt-BR")}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteList(list.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
