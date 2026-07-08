import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/hooks/useAuth";
import {
  useShoppingLists,
  useCreateList,
  useDeleteList,
} from "@/hooks/queries/useShoppingLists";
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

export default function Listas() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();

  const { data: lists = [], isLoading, error } = useShoppingLists();
  const createList = useCreateList();
  const deleteList = useDeleteList();

  const [newListName, setNewListName] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  if (error) {
    toast({
      title: "Erro ao carregar listas",
      description: (error as Error).message,
      variant: "destructive",
    });
  }

  const handleCreate = () => {
    if (!newListName.trim() || !user) return;
    createList.mutate(
      { name: newListName.trim(), userId: user.id },
      {
        onSuccess: () => {
          toast({ title: "Lista criada!" });
          setNewListName("");
          setDialogOpen(false);
        },
        onError: (err) =>
          toast({
            title: "Erro ao criar lista",
            description: (err as Error).message,
            variant: "destructive",
          }),
      }
    );
  };

  const handleDelete = (id: string) => {
    deleteList.mutate(id, {
      onSuccess: () => toast({ title: "Lista excluída" }),
      onError: (err) =>
        toast({
          title: "Erro ao excluir lista",
          description: (err as Error).message,
          variant: "destructive",
        }),
    });
  };

  if (isLoading) {
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
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                />
                <Button
                  onClick={handleCreate}
                  className="w-full touch-target"
                  disabled={createList.isPending || !newListName.trim()}
                >
                  {createList.isPending ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : null}
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
                        handleDelete(list.id);
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
