import { useState, useRef } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Loader2, FileText, Camera, X, ImagePlus, AlertTriangle, Image as ImageIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Leitor() {
  const { session } = useAuth();
  const { toast } = useToast();

  const [scanning, setScanning] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  // Estado para controle de duplicatas
  const [duplicateInfo, setDuplicateInfo] = useState<{
    mensagem: string;
    existing: {
      id: string;
      supermarket_name: string;
      purchase_date: string;
      total_amount: number;
    };
    scraped_data: unknown;
  } | null>(null);

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
    if (cameraInputRef.current) {
      cameraInputRef.current.value = "";
    }
    if (galleryInputRef.current) {
      galleryInputRef.current.value = "";
    }
  };

  const sendToBackend = async (file: File, forceSave = false) => {
    if (!session?.access_token) {
      throw new Error("Sessão expirada. Faça login novamente.");
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("force_save", forceSave ? "true" : "false");

    const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:8000";
    const response = await fetch(`${apiUrl}/upload-cupom`, {
      method: "POST",
      headers: {
        // O user_id NÃO é mais enviado — o backend o deriva deste token (JWT).
        Authorization: `Bearer ${session.access_token}`,
      },
      body: formData,
    });

    if (!response.ok) {
      let errorMessage = `Erro HTTP: ${response.status}`;
      try {
        const errorData = await response.json();
        if (errorData.detail) errorMessage = errorData.detail;
      } catch {
        /* corpo não-JSON: mantém a mensagem HTTP padrão */
      }
      throw new Error(errorMessage);
    }

    return response.json();
  };

  const handleProcessImage = async (forceSave = false) => {
    if (!imageFile) return;
    setScanning(true);

    try {
      const backendData = await sendToBackend(imageFile, forceSave);

      // Nota duplicada — abrir dialog de confirmação
      if (backendData.status === "duplicate") {
        setDuplicateInfo({
          mensagem:     backendData.mensagem,
          existing:     backendData.existing,
          scraped_data: backendData.scraped_data,
        });
        return;
      }

      // Sucesso
      toast({
        title: "Nota salva! ✅",
        description: backendData.mensagem || "Nota processada e salva com sucesso.",
      });
      handleClearImage();

    } catch (e: unknown) {
      const error = e as Error;
      toast({
        title: "Erro ao processar",
        description: error.message,
        variant: "destructive",
      });
      console.error(error);
    } finally {
      setScanning(false);
    }
  };

  const handleForceSave = async () => {
    setDuplicateInfo(null);
    await handleProcessImage(true);
  };

  const handleCancelDuplicate = () => {
    setDuplicateInfo(null);
  };

  return (
    <AppLayout>
      <div className="container px-4 py-6 animate-fade-in">
        <div className="mb-6">
          <h1 className="font-display font-bold text-2xl">Leitor de Notas</h1>
          <p className="text-muted-foreground text-sm">
            Tire uma foto ou envie a imagem do cupom com o QR Code
          </p>
        </div>

        <div className="space-y-4">
          <Card className="card-elevated">
            <CardContent className="p-6">
              {/* Input para CÂMERA (com capture) */}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                ref={cameraInputRef}
                onChange={handleImageUpload}
              />
              {/* Input para GALERIA (sem capture) */}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                ref={galleryInputRef}
                onChange={handleImageUpload}
              />

              {!imagePreview ? (
                <div className="max-w-[320px] mx-auto space-y-4">
                  <div className="aspect-[4/3] bg-muted rounded-2xl flex flex-col items-center justify-center border-2 border-dashed border-border">
                    <ImagePlus className="h-10 w-10 text-muted-foreground mb-3" />
                    <p className="text-sm font-medium text-foreground text-center px-4">
                      Foto do Cupom Fiscal
                    </p>
                    <p className="text-xs text-muted-foreground text-center mt-1 px-4">
                      Escolha como enviar a imagem do cupom
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Button
                      variant="outline"
                      className="h-14 flex flex-col items-center justify-center gap-1 touch-target"
                      onClick={() => cameraInputRef.current?.click()}
                    >
                      <Camera className="h-5 w-5" />
                      <span className="text-xs">Tirar Foto</span>
                    </Button>
                    <Button
                      variant="outline"
                      className="h-14 flex flex-col items-center justify-center gap-1 touch-target"
                      onClick={() => galleryInputRef.current?.click()}
                    >
                      <ImageIcon className="h-5 w-5" />
                      <span className="text-xs">Galeria</span>
                    </Button>
                  </div>
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
                    onClick={() => handleProcessImage(false)}
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
        </div>
      </div>

      {/* Dialog de Confirmação de Duplicata */}
      <AlertDialog open={!!duplicateInfo} onOpenChange={(open) => !open && handleCancelDuplicate()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              Nota já cadastrada
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>{duplicateInfo?.mensagem}</p>
                {duplicateInfo?.existing && (
                  <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm space-y-1">
                    <p className="font-medium text-foreground">Compra existente no histórico:</p>
                    <p>🏪 <span className="text-foreground">{duplicateInfo.existing.supermarket_name}</span></p>
                    <p>📅 <span className="text-foreground">
                      {duplicateInfo.existing.purchase_date
                        ? new Date(duplicateInfo.existing.purchase_date + "T12:00:00").toLocaleDateString("pt-BR")
                        : "Data não informada"}
                    </span></p>
                    <p>💰 <span className="text-foreground">
                      R$ {Number(duplicateInfo.existing.total_amount).toFixed(2).replace(".", ",")}
                    </span></p>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Deseja adicionar mesmo assim? Isso criará uma entrada duplicada no histórico.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelDuplicate}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleForceSave}
              className="bg-yellow-500 hover:bg-yellow-600 text-white"
            >
              Adicionar mesmo assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </AppLayout>
  );
}
