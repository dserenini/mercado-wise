import { Link, useLocation } from "react-router-dom";
import { Home, List, ScanLine, Barcode, History, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { path: "/", icon: Home, label: "Home" },
  { path: "/listas", icon: List, label: "Listas" },
  { path: "/leitor", icon: ScanLine, label: "Leitor" },
  { path: "/preco", icon: Barcode, label: "Preço" },
  { path: "/historico", icon: History, label: "Histórico" },
  { path: "/insights", icon: TrendingUp, label: "Insights" },
];

export function BottomNav() {
  const location = useLocation();

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-card/95 backdrop-blur-lg border-t border-border safe-bottom z-50">
      <div className="flex justify-around items-center px-2 py-1">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          const Icon = item.icon;
          
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "nav-item touch-target flex-1 max-w-[80px]",
                isActive ? "nav-item-active" : "nav-item-inactive"
              )}
            >
              <Icon className={cn("h-6 w-6", isActive && "animate-pulse-soft")} />
              <span className="text-xs font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
