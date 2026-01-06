import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Loader2, List, ScanLine, History, TrendingUp } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";

const navButtons = [
  { path: "/listas", icon: List, label: "Listas", description: "Gerencie suas listas de compras" },
  { path: "/leitor", icon: ScanLine, label: "Leitor", description: "Escaneie notas fiscais" },
  { path: "/historico", icon: History, label: "Histórico", description: "Veja suas compras anteriores" },
  { path: "/insights", icon: TrendingUp, label: "Insights", description: "Analise seus gastos" },
];

export default function Index() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Se não estiver logado, mostra landing page
  if (!user) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container px-4 py-8 flex flex-col items-center justify-center min-h-screen">
          <div className="text-center mb-8 animate-fade-in">
            <div className="gradient-primary rounded-3xl p-6 inline-block mb-6 shadow-lg">
              <span className="text-6xl">🛒</span>
            </div>
            <h1 className="font-display font-bold text-4xl text-foreground mb-3">
              Mercado Fácil
            </h1>
            <p className="text-lg text-muted-foreground max-w-sm mx-auto">
              Economize nas suas compras com inteligência
            </p>
          </div>

          <div className="w-full max-w-sm space-y-3">
            <Button
              onClick={() => navigate("/auth")}
              className="w-full touch-target text-lg font-semibold"
              size="lg"
            >
              Começar Agora
            </Button>
            <p className="text-xs text-center text-muted-foreground">
              Focado em Minas Gerais 📍
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Usuário logado: mostra Home com navegação
  return (
    <AppLayout showNav={true}>
      <div className="container px-4 py-8 flex flex-col items-center">
        {/* Logo centralizado */}
        <div className="text-center mb-10 animate-fade-in">
          <div className="gradient-primary rounded-3xl p-6 inline-block mb-4 shadow-lg">
            <span className="text-6xl">🛒</span>
          </div>
          <h1 className="font-display font-bold text-3xl text-foreground mb-2">
            Mercado Fácil
          </h1>
          <p className="text-muted-foreground">
            Economize com inteligência
          </p>
        </div>

        {/* Grid de navegação */}
        <div className="grid grid-cols-2 gap-4 w-full max-w-md">
          {navButtons.map((item, i) => {
            const Icon = item.icon;
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className="card-elevated p-6 flex flex-col items-center gap-3 hover:scale-[1.02] active:scale-[0.98] transition-transform animate-fade-in touch-target"
                style={{ animationDelay: `${i * 100}ms` }}
              >
                <div className="bg-primary/10 rounded-2xl p-4">
                  <Icon className="h-8 w-8 text-primary" />
                </div>
                <div className="text-center">
                  <span className="font-semibold text-foreground block">
                    {item.label}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {item.description}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </AppLayout>
  );
}
