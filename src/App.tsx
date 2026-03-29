import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { ThemeProvider } from "@/hooks/useTheme";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Listas from "./pages/Listas";
import Leitor from "./pages/Leitor";
import Historico from "./pages/Historico";
import Insights from "./pages/Insights";
import NotFound from "./pages/NotFound";
import ListaDetalhes from "./pages/ListaDetalhes";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/listas" element={<Listas />} />
              <Route path="/listas/:id" element={<ListaDetalhes />} />
              <Route path="/leitor" element={<Leitor />} />
              <Route path="/historico" element={<Historico />} />
              <Route path="/insights" element={<Insights />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
