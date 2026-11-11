// Escanear nota comprida (protótipo): câmera ao vivo que tira os trechos sozinha.
// 1. Trecho 1: enquadre o topo da nota; com a câmera parada e nítida, tira sozinha.
// 2. Depois de cada trecho, o rodapé dele aparece apagado no topo da tela: desça a
//    câmera até o papel encaixar nessa faixa; com encaixe, parada e nítida, tira o
//    próximo. Sobreposição garantida entre trechos (a leitura junta sem perder linha).
// 3. Ao ver o QR Code do rodapé, avisa que chegou ao fim. "Terminei" mostra os trechos.
// Ainda não envia: serve para testar a captura no celular. ?debug=1 mostra os números.
import {
  decide,
  findOverlap,
  LIMITS,
  motion,
  STRIP,
  sharpness,
  toGray,
} from "./scan-core.js";

const MAX_EDGE = 2576; // mesmos limites do envio de foto (upload.js)
const MAX_PIXELS = 3_750_000;
const DEBUG = new URLSearchParams(location.search).has("debug");

const $ = (id) => document.getElementById(id);
const video = $("scan-video");
const ghost = $("scan-ghost");
const hint = $("scan-hint");
const debug = $("scan-debug");
const count = $("scan-count");
const thumbs = $("scan-thumbs");

const small = document.createElement("canvas");
const smallCtx = small.getContext("2d", { willReadFrequently: true });

let stream = null;
let running = false;
let parts = []; // { blob, url, gray }
let prev = null; // quadro pequeno anterior (movimento)
let still = 0; // desde quando a câmera está parada
let sharpHistory = []; // [tempo, nitidez] dos últimos segundos
let qrDetector = null;
let lastQrCheck = 0;
let atEnd = false;

const HINTS = {
  first: "Enquadre o topo da nota (com o nome do mercado) e segure parado…",
  hold: "Segure parado…",
  blurry: "Está borrado: aproxime ou afaste um pouco até ficar nítido.",
  down: "Desça a câmera até o papel encaixar na faixa apagada do topo.",
  back: "Desceu demais: volte um pouco até a faixa apagada encaixar.",
  capture: "✓ Trecho capturado.",
  end: "Chegou ao QR Code: é o fim da nota. Toque em “Terminei”.",
};

/** Quadro atual reduzido (o navegador reduz) → cinza para as contas. */
function frame() {
  const w = 120;
  const h = Math.round((video.videoHeight / video.videoWidth) * w);
  small.width = w;
  small.height = h;
  smallCtx.drawImage(video, 0, 0, w, h);
  return toGray(smallCtx.getImageData(0, 0, w, h).data, w, h, w);
}

/** Foto do trecho na resolução da câmera (reduzida como no envio de foto). */
async function grab() {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const scale = Math.min(
    1,
    MAX_EDGE / Math.max(vw, vh),
    Math.sqrt(MAX_PIXELS / (vw * vh)),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(vw * scale);
  canvas.height = Math.round(vh * scale);
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.88));
  // Faixa de baixo do trecho: vira o guia apagado no topo da tela.
  const sy = Math.round(canvas.height * STRIP.from);
  const sh = Math.round(canvas.height * (STRIP.to - STRIP.from));
  const strip = document.createElement("canvas");
  strip.width = canvas.width;
  strip.height = sh;
  strip
    .getContext("2d")
    .drawImage(canvas, 0, sy, canvas.width, sh, 0, 0, canvas.width, sh);
  return { blob, stripUrl: strip.toDataURL("image/jpeg", 0.7) };
}

async function capture(gray) {
  running = false; // pausa a análise enquanto grava
  const { blob, stripUrl } = await grab();
  const url = URL.createObjectURL(blob);
  parts.push({ blob, url, gray });
  navigator.vibrate?.(40);
  video.parentElement.classList.add("flash");
  setTimeout(() => video.parentElement.classList.remove("flash"), 180);
  ghost.src = stripUrl;
  ghost.style.height = `${(STRIP.to - STRIP.from) * 100}%`;
  ghost.hidden = false;
  render();
  still = 0;
  hint.textContent = HINTS.capture;
  // Um respiro antes de procurar o próximo: a pessoa começa a descer.
  setTimeout(() => {
    if (stream) {
      running = true;
      loop();
    }
  }, 700);
}

function render() {
  count.textContent = `${parts.length} ${parts.length === 1 ? "trecho" : "trechos"}`;
  thumbs.replaceChildren(
    ...parts.map((p, i) => {
      const img = document.createElement("img");
      img.src = p.url;
      img.alt = `Trecho ${i + 1}`;
      return img;
    }),
  );
  $("scan-undo").disabled = parts.length === 0;
  $("scan-done").disabled = parts.length === 0;
}

async function checkQr(now) {
  if (!qrDetector || now - lastQrCheck < 1000) return;
  lastQrCheck = now;
  const [hit] = await qrDetector.detect(video).catch(() => []);
  atEnd = Boolean(hit && /\.gov\.br/.test(hit.rawValue ?? ""));
}

async function loop() {
  while (running) {
    const now = performance.now();
    if (video.readyState >= 2) {
      const cur = frame();
      const moved = prev ? motion(prev, cur) : 255;
      prev = cur;
      if (moved < LIMITS.steadyMotion) still ||= now;
      else still = 0;
      const sharp = sharpness(cur);
      // Referência de "melhor nitidez recente": só quadros com a câmera quase
      // parada (quadro em movimento dá número falso, alto ou baixo).
      sharpHistory = sharpHistory.filter(([t]) => now - t < 3000);
      if (moved < LIMITS.steadyMotion * 2) sharpHistory.push([now, sharp]);
      const bestSharp = Math.max(sharp, ...sharpHistory.map(([, s]) => s));
      const last = parts.at(-1);
      const overlap = last ? findOverlap(last.gray, cur) : null;
      const action = decide({
        steadyFor: still ? now - still : 0,
        sharp,
        bestSharp,
        overlap,
      });
      await checkQr(now);

      if (action === "capture") {
        await capture(cur);
        return;
      }
      hint.textContent =
        atEnd && parts.length > 0
          ? HINTS.end
          : parts.length === 0 && action !== "blurry"
            ? HINTS.first
            : HINTS[action];
      if (DEBUG)
        debug.textContent = `movimento ${moved.toFixed(1)} · nitidez ${sharp.toFixed(1)}/${bestSharp.toFixed(1)} · encaixe ${overlap ? `${overlap.score.toFixed(2)} em ${(overlap.offset * 100).toFixed(0)}%` : "—"} · ${action}`;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function start() {
  $("scan-review").hidden = true;
  $("scan-camera").hidden = false;
  hint.textContent = "Abrindo a câmera…";
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
  } catch (error) {
    hint.textContent =
      error?.name === "NotAllowedError"
        ? "Sem permissão para usar a câmera. Libere nas configurações do navegador, ou envie fotos pela tela anterior."
        : "Não deu para abrir a câmera neste aparelho.";
    return;
  }
  video.srcObject = stream;
  await video.play().catch(() => {});
  // Câmera no topo da tela: dicas e botões logo abaixo, sem rolar.
  $("scan-camera").scrollIntoView({ behavior: "smooth", block: "start" });
  // Lanterna: só alguns aparelhos (Android/Chrome) deixam ligar pelo navegador.
  const [track] = stream.getVideoTracks();
  if (track?.getCapabilities?.().torch) $("scan-torch").hidden = false;
  if ("BarcodeDetector" in window)
    qrDetector = new window.BarcodeDetector({ formats: ["qr_code"] });
  running = true;
  loop();
}

function stop() {
  running = false;
  for (const t of stream?.getTracks() ?? []) t.stop();
  stream = null;
}

$("scan-shoot").addEventListener("click", () => {
  if (stream && video.readyState >= 2) capture(frame());
});
$("scan-undo").addEventListener("click", () => {
  const last = parts.pop();
  if (last) URL.revokeObjectURL(last.url);
  const prevPart = parts.at(-1);
  ghost.hidden = !prevPart;
  if (prevPart) {
    // Refaz o guia a partir do trecho anterior.
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      const sy = Math.round(img.height * STRIP.from);
      const sh = Math.round(img.height * (STRIP.to - STRIP.from));
      c.width = img.width;
      c.height = sh;
      c.getContext("2d").drawImage(
        img,
        0,
        sy,
        img.width,
        sh,
        0,
        0,
        img.width,
        sh,
      );
      ghost.src = c.toDataURL("image/jpeg", 0.7);
    };
    img.src = prevPart.url;
  }
  render();
});
$("scan-torch").addEventListener("click", async (event) => {
  const [track] = stream?.getVideoTracks() ?? [];
  const on = event.currentTarget.getAttribute("aria-pressed") !== "true";
  await track?.applyConstraints({ advanced: [{ torch: on }] }).catch(() => {});
  event.currentTarget.setAttribute("aria-pressed", String(on));
});
$("scan-done").addEventListener("click", async () => {
  // Fim da nota: o último pedaço costuma ser menor que uma descida inteira, então
  // a captura automática não dispara. Se a câmera mostra algo além do último
  // trecho (desceu pelo menos ~5%), tira esse trecho final antes de encerrar.
  if (stream && video.readyState >= 2 && parts.length > 0) {
    const cur = frame();
    const o = findOverlap(parts.at(-1).gray, cur);
    if (o.score < LIMITS.lostOverlap || o.offset < STRIP.from - 0.05)
      await capture(cur);
  }
  stop();
  $("scan-camera").hidden = true;
  $("scan-review").hidden = false;
  $("scan-stack").replaceChildren(
    ...parts.map((p, i) => {
      const fig = document.createElement("figure");
      const img = document.createElement("img");
      img.src = p.url;
      img.alt = `Trecho ${i + 1}`;
      const cap = document.createElement("figcaption");
      cap.textContent = `Trecho ${i + 1} · ${Math.round(p.blob.size / 1024)} KB`;
      fig.append(img, cap);
      return fig;
    }),
  );
  $("scan-summary").textContent =
    `${parts.length} ${parts.length === 1 ? "trecho" : "trechos"}, ${Math.round(parts.reduce((a, p) => a + p.blob.size, 0) / 1024)} KB no total.`;
});
$("scan-restart").addEventListener("click", () => {
  for (const p of parts) URL.revokeObjectURL(p.url);
  parts = [];
  prev = null;
  ghost.hidden = true;
  render();
  start();
});
$("scan-start").addEventListener("click", (event) => {
  event.currentTarget.hidden = true;
  start();
});
window.addEventListener("pagehide", stop);
if (DEBUG) debug.hidden = false;
render();
