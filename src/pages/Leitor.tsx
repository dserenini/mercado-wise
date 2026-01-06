import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { QrCode, Link, Loader2, AlertCircle, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Leitor() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();

  const [nfcUrl, setNfcUrl] = useState("");
  const [scanning, setScanning] = useState(false);

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
        description: "O processamento da nota será feito em background. Por enquanto, use a entrada manual no Histórico.",
      });
      setScanning(false);
    }, 2000);
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
            Escaneie o QR Code ou cole o link da nota
          </p>
        </div>

        <Tabs defaultValue="scanner" className="space-y-6">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="scanner" className="gap-2">
              <QrCode className="h-4 w-4" />
              Scanner
            </TabsTrigger>
            <TabsTrigger value="link" className="gap-2">
              <Link className="h-4 w-4" />
              Link
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

            <Card className="card-elevated">
              <CardContent className="p-4">
                <div className="flex items-start gap-3 text-sm text-muted-foreground">
                  <FileText className="h-5 w-5 shrink-0 mt-0.5" />
                  <p>
                    Para adicionar compras manualmente, acesse a aba <strong>Histórico</strong> e clique em "Adicionar".
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="link" className="space-y-4">
            {/* URL Input */}
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

            <Card className="card-elevated">
              <CardContent className="p-4">
                <div className="flex items-start gap-3 text-sm text-muted-foreground">
                  <FileText className="h-5 w-5 shrink-0 mt-0.5" />
                  <p>
                    Para adicionar compras manualmente, acesse a aba <strong>Histórico</strong> e clique em "Adicionar".
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
