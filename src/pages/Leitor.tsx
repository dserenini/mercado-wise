import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Loader2, FileText, Camera, X, ImagePlus, AlertTriangle, Image as ImageIcon, CheckCircle2, RefreshCw, Pencil } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Semaforo = "verde" | "amarelo" | "vermelho";

interface VerdictItem {
  index: number;
  descricao: string | null;
  label: "ok" | "baixa_confianca" | "falhou" | string;
  problems: string[];
}

interface NotaFotoResult {
  status: "saved" | "saved_review" | "reshoot" | "duplicate";
  semaforo: Semaforo;
  purchase_id?: string | null;
  mensagem: string;
  veredito?: {
    n_ok: number; n_low: number; n_fail: number;
    sum_items: number; total: number | null; total_ok: boolean | null;
    itens: VerdictItem[];
  };
}

export default function Leitor() {
  const { session } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [scanning, setScanning] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  // Resultado da leitura por foto (semáforo + itens sinalizados pelos validadores)
  const [result, setResult] = useState<NotaFotoResult | null>(null);

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
      setResult(null);
      setImageFile(file);
      const url = URL.createObjectURL(file);
      setImagePreview(url);
    }
  };

  const handleClearImage = () => {
    setImageFile(null);
    setResult(null);
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
    const response = await fetch(`${apiUrl}/upload-nota-foto`, {
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
    setResult(null);

    try {
      const backendData = await sendToBackend(imageFile, forceSave);

      // Nota duplicada — abrir dialog de confirmação
      if (backendData.status === "duplicate") {
        setDuplicateInfo({
          mensagem:     backendData.mensagem,
          existing:     backendData.existing,
          scraped_data: backendData.data ?? backendData.scraped_data,
        });
        return;
      }

      // Foto ruim (vermelho): não salvou — pedir nova foto, manter a atual para reenquadrar
      if (backendData.status === "reshoot") {
        setResult(backendData as NotaFotoResult);
        toast({
          title: "Foto não ficou boa",
          description: backendData.mensagem,
          variant: "destructive",
        });
        return;
      }

      // Salvou (verde) ou salvou com ressalvas (amarelo)
      setResult(backendData as NotaFotoResult);
      toast({
        title: backendData.semaforo === "amarelo" ? "Nota salva com ressalvas ⚠️" : "Nota salva! ✅",
        description: backendData.mensagem || "Nota processada e salva com sucesso.",
      });
      if (backendData.semaforo !== "amarelo") handleClearImage();

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
            Tire uma foto nítida do cupom inteiro — lemos os itens e os códigos de barras
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
                        Lendo a nota... (pode levar ~30s)
                      </>
                    ) : (
                      "Analisar Cupom na IA"
                    )}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {result && (
            <ResultPanel
              result={result}
              onRetry={handleClearImage}
              onConferir={
                result.purchase_id
                  ? () => navigate(`/historico?edit=${result.purchase_id}`)
                  : () => navigate("/historico")
              }
            />
          )}

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

/** Painel de resultado da leitura por foto: semáforo + itens sinalizados pelos validadores. */
function ResultPanel({ result, onRetry, onConferir }: { result: NotaFotoResult; onRetry: () => void; onConferir: () => void }) {
  const { semaforo, veredito } = result;
  const flagged = veredito?.itens.filter((i) => i.label !== "ok") ?? [];

  const theme = {
    verde:    { border: "border-green-500/40",  bg: "bg-green-500/10",  Icon: CheckCircle2,  color: "text-green-600" },
    amarelo:  { border: "border-yellow-500/40", bg: "bg-yellow-500/10", Icon: AlertTriangle, color: "text-yellow-600" },
    vermelho: { border: "border-red-500/40",    bg: "bg-red-500/10",    Icon: AlertTriangle, color: "text-red-600" },
  }[semaforo];
  const { Icon } = theme;

  return (
    <Card className={`card-elevated ${theme.border}`}>
      <CardContent className={`p-4 space-y-3 ${theme.bg} rounded-xl`}>
        <div className="flex items-start gap-2">
          <Icon className={`h-5 w-5 shrink-0 mt-0.5 ${theme.color}`} />
          <div className="flex-1">
            <p className="font-medium text-foreground text-sm">{result.mensagem}</p>
            {veredito && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {veredito.n_ok} ok · {veredito.n_low} a conferir · {veredito.n_fail} com erro ·
                soma R$ {Number(veredito.sum_items).toFixed(2).replace(".", ",")}
                {veredito.total != null && ` / total R$ ${Number(veredito.total).toFixed(2).replace(".", ",")}`}
              </p>
            )}
          </div>
        </div>

        {flagged.length > 0 && (
          <div className="rounded-lg border border-border bg-background/60 p-3 space-y-1.5">
            <p className="text-xs font-medium text-foreground">Itens para conferir:</p>
            {flagged.map((it) => (
              <div key={it.index} className="text-xs">
                <span className="text-foreground">{it.descricao || `Item ${it.index + 1}`}</span>
                {it.problems.length > 0 && (
                  <span className="text-muted-foreground"> — {it.problems.join("; ")}</span>
                )}
              </div>
            ))}
            {semaforo === "amarelo" && (
              <p className="text-xs text-muted-foreground pt-1">
                A nota foi salva. Confira e ajuste esses itens no Histórico.
              </p>
            )}
          </div>
        )}

        {semaforo === "amarelo" && (
          <Button variant="outline" className="w-full touch-target" onClick={onConferir}>
            <Pencil className="h-4 w-4 mr-2" />
            Conferir no Histórico
          </Button>
        )}

        {semaforo === "vermelho" && (
          <Button variant="outline" className="w-full touch-target" onClick={onRetry}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Tirar outra foto
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
