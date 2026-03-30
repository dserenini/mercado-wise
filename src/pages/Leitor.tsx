import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { QrCode, Link, Loader2, AlertCircle, FileText, Camera, Upload, X, ImagePlus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Leitor() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();

  const [nfcUrl, setNfcUrl] = useState("");
  const [scanning, setScanning] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    }
  }, [user, authLoading, navigate]);

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setImageFile(file);
      const url = URL.createObjectURL(file);
      setImagePreview(url);
    }
  };

  const handleClearImage = () => {
    setImageFile(null);
    if (imagePreview) {
      URL.revokeObjectURL(imagePreview);
    }
    setImagePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleProcessImage = async () => {
    if (!imageFile) return;
    setScanning(true);
    
    // Preparando a imagem e dados para envio
    const formData = new FormData();
    formData.append("file", imageFile);
    if (user) {
      formData.append("user_id", user.id);
    }

    try {
      const response = await fetch("http://localhost:8000/upload-cupom", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Erro: ${response.status}`);
      }

      const backendData = await response.json();
      toast({
        title: "Sucesso no Backend! 🐍",
        description: backendData.mensagem || "O Python processou sua foto isolada com sucesso.",
      });

    } catch (e: unknown) {
      const error = e as Error;
      toast({
        title: "Servidor Ausente",
        description: "Execute o Python na porta 8000 (uvicorn main:app). Detalhes: " + error.message,
        variant: "destructive"
      });
      console.error(error);
    } finally {
      setScanning(false);
    }
  };

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
              <Camera className="h-4 w-4" />
              Foto / Arquivo
            </TabsTrigger>
            <TabsTrigger value="link" className="gap-2">
              <Link className="h-4 w-4" />
              Link
            </TabsTrigger>
          </TabsList>

          <TabsContent value="scanner" className="space-y-4">
            <Card className="card-elevated">
              <CardContent className="p-6">
                <input 
                  type="file" 
                  accept="image/*" 
                  capture="environment" 
                  className="hidden" 
                  ref={fileInputRef}
                  onChange={handleImageUpload}
                />
                
                {!imagePreview ? (
                  <div 
                    className="aspect-square max-w-[280px] mx-auto bg-muted rounded-2xl flex flex-col items-center justify-center border-2 border-dashed border-border hover:bg-muted/80 transition-colors cursor-pointer"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <ImagePlus className="h-12 w-12 text-muted-foreground mb-4" />
                    <p className="text-sm font-medium text-foreground text-center px-4">
                      Tirar Foto ou Escolher
                    </p>
                    <p className="text-xs text-muted-foreground text-center mt-2 px-4">
                      Tire uma foto legível do cupom fiscal
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4 max-w-[280px] mx-auto">
                    <div className="relative aspect-auto rounded-xl overflow-hidden border">
                      <img src={imagePreview} alt="Preview do Cupom" className="w-full h-auto object-contain" />
                      <Button 
                        size="icon" 
                        variant="destructive" 
                        className="absolute top-2 right-2 h-8 w-8 rounded-full shadow-md"
                        onClick={handleClearImage}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    
                    <Button 
                      onClick={handleProcessImage}
                      className="w-full touch-target"
                      disabled={scanning}
                    >
                      {scanning ? (
                        <>
                          <Loader2 className="h-5 w-5 animate-spin mr-2" />
                          Processando Imagem...
                        </>
                      ) : (
                        "Analisar Cupom na IA"
                      )}
                    </Button>
                  </div>
                )}
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
