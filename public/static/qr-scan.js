// Nota pelo QR Code (tela "Enviar notas").
// 1. Câmera ao vivo procurando o QR (como no Pix): BarcodeDetector nativo quando o
//    navegador tem; senão ZXing (WebAssembly, da CDN, só quando precisa).
// 2. QR de NFC-e lido: a pessoa abre a página da SEFAZ (no navegador dela, que passa
//    por captcha se houver), copia tudo e cola aqui. O servidor não abre a página.
// 3. Qualquer falha: avisa e manda para a foto (com o endereço do QR, se já lido).

const ZXING = "https://cdn.jsdelivr.net/npm/zxing-wasm@3.1.6/dist";
const $ = (id) => document.getElementById(id);
const panel = $("qr-panel");
const video = $("qr-video");
const status = $("qr-status");
const fallbackBox = $("qr-fallback");

let stream = null;
let running = false;
let qr = null; // { url, key }

/** Mesmas regras do servidor (nfce.ts): .gov.br e chave de 44 dígitos em `p`. */
function parseQr(text) {
  try {
    const url = new URL(text.trim());
    if (!/^https?:$/.test(url.protocol) || !url.hostname.endsWith(".gov.br"))
      return null;
    const key = /^\d{44}/.exec(
      (url.searchParams.get("p") ?? "").replace(/\s/g, ""),
    );
    return key ? { url: url.toString(), key: key[0] } : null;
  } catch {
    return null;
  }
}

/** Detector de QR: nativo se houver, senão ZXing. Devolve frame → texto | null. */
async function makeDetector() {
  if ("BarcodeDetector" in window) {
    const formats = await window.BarcodeDetector.getSupportedFormats();
    if (formats.includes("qr_code")) {
      const native = new window.BarcodeDetector({ formats: ["qr_code"] });
      return async (source) =>
        (await native.detect(source))[0]?.rawValue ?? null;
    }
  }
  const zxing = await import(`${ZXING}/es/reader/index.js`);
  zxing.prepareZXingModule({
    overrides: { locateFile: (path) => `${ZXING}/reader/${path}` },
    fireImmediately: true,
  });
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return async (source) => {
    canvas.width = source.videoWidth;
    canvas.height = source.videoHeight;
    ctx.drawImage(source, 0, 0);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const [hit] = await zxing.readBarcodes(image, {
      formats: ["QRCode"],
      tryHarder: true,
      maxNumberOfSymbols: 1,
    });
    return hit?.text ?? null;
  };
}

function stopCamera() {
  running = false;
  for (const track of stream?.getTracks() ?? []) track.stop();
  stream = null;
  video.srcObject = null;
}

/** Não deu pelo QR: avisa e leva para a foto (o QR já lido vai junto). */
function fallback(reason) {
  stopCamera();
  panel.hidden = true;
  fallbackBox.textContent = `Não deu pelo QR Code (${reason}). Vamos pela foto da nota: toque em “Fotografar ou escolher fotos”.`;
  fallbackBox.hidden = false;
  const photo = $("photo-button");
  photo.scrollIntoView({ behavior: "smooth", block: "center" });
  photo.focus({ preventScroll: true });
}

async function start() {
  fallbackBox.hidden = true;
  panel.hidden = false;
  $("qr-camera").hidden = false;
  $("qr-paste").hidden = true;
  status.textContent = "Abrindo a câmera…";
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
  if (!navigator.mediaDevices?.getUserMedia) {
    fallback("este navegador não dá acesso à câmera");
    return;
  }
  let detect;
  try {
    [stream, detect] = await Promise.all([
      navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      }),
      makeDetector(),
    ]);
  } catch (error) {
    fallback(
      error?.name === "NotAllowedError"
        ? "sem permissão para usar a câmera"
        : "não deu para abrir a câmera",
    );
    return;
  }
  video.srcObject = stream;
  await video.play().catch(() => {});
  status.textContent = "Aponte a câmera para o QR Code da nota…";
  running = true;

  // Um quadro a cada ~250 ms: rápido para a pessoa, leve para o celular.
  while (running) {
    const text =
      video.readyState >= 2 ? await detect(video).catch(() => null) : null;
    if (!running) return;
    if (text) {
      const found = parseQr(text);
      if (found) {
        read(found);
        return;
      }
      status.textContent =
        "Esse QR Code não é de nota fiscal. Procure o QR da NFC-e (perto do fim do cupom).";
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

function read(found) {
  qr = found;
  stopCamera();
  navigator.vibrate?.(60);
  $("qr-url").value = found.url; // se a pessoa for pela foto, a chave vai junto
  $("qr-open").href = found.url;
  $("qr-camera").hidden = true;
  $("qr-paste").hidden = false;
  $("qr-result").textContent = "";
  $("qr-open").focus();
}

async function send() {
  const text = $("qr-text").value;
  const result = $("qr-result");
  if (!text.trim()) {
    result.textContent = "Cole o conteúdo da página da SEFAZ antes de enviar.";
    return;
  }
  if (!text.replace(/\D/g, "").includes(qr.key)) {
    result.textContent =
      "Esse texto não é da nota do QR Code (não traz a chave de acesso dela). Copie a página inteira da SEFAZ.";
    return;
  }
  $("qr-send").setAttribute("aria-busy", "true");
  result.textContent = "Enviando…";
  try {
    const res = await fetch("/receipts/page", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ qr_url: qr.url, page_text: text }),
    });
    const r = await res.json();
    if (r.kind === "queued") {
      result.textContent = `✓ Nota #${r.id} enviada pelo QR Code; aparece na lista como “lendo…”.`;
      setTimeout(() => location.assign("/"), 1200);
    } else if (r.kind === "duplicate") {
      result.replaceChildren(
        "Essa nota já está cadastrada: ",
        Object.assign(document.createElement("a"), {
          href: `/receipts/${r.id}`,
          textContent: `nota #${r.id}`,
        }),
        ".",
      );
    } else {
      fallback(r.message ?? "o servidor recusou");
    }
  } catch {
    fallback("sem conexão com o servidor");
  } finally {
    $("qr-send").removeAttribute("aria-busy");
  }
}

$("qr-start").addEventListener("click", start);
$("qr-cancel").addEventListener("click", () => {
  stopCamera();
  panel.hidden = true;
});
$("qr-send").addEventListener("click", send);
$("qr-photo").addEventListener("click", () => fallback("escolheu a foto"));
// "Colar" num toque, onde o navegador deixa ler a área de transferência.
$("qr-paste-button").addEventListener("click", async () => {
  try {
    $("qr-text").value = await navigator.clipboard.readText();
  } catch {
    $("qr-result").textContent =
      "O navegador não deixou colar por aqui: toque e segure no campo e escolha Colar.";
    $("qr-text").focus();
  }
});
$("photo-choice").addEventListener("click", (event) => {
  event.preventDefault();
  stopCamera();
  panel.hidden = true;
  $("photo-button").scrollIntoView({ behavior: "smooth", block: "center" });
  $("photo-button").focus({ preventScroll: true });
});
// Saiu da tela: desliga a câmera.
window.addEventListener("pagehide", stopCamera);
