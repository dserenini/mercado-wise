import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Loader2, ShoppingCart, TrendingDown, QrCode, BarChart3 } from "lucide-react";

export default function Index() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && user) {
      navigate("/listas");
    }
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

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

        <div className="grid grid-cols-2 gap-4 max-w-sm w-full mb-8">
          {[
            { icon: ShoppingCart, label: "Listas inteligentes" },
            { icon: QrCode, label: "Scanner de notas" },
            { icon: TrendingDown, label: "Acompanhe preços" },
            { icon: BarChart3, label: "Insights de economia" },
          ].map((feature, i) => (
            <div
              key={feature.label}
              className="card-elevated p-4 flex flex-col items-center gap-2 animate-fade-in"
              style={{ animationDelay: `${i * 100}ms` }}
            >
              <feature.icon className="h-8 w-8 text-primary" />
              <span className="text-xs text-center font-medium text-muted-foreground">
                {feature.label}
              </span>
            </div>
          ))}
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
