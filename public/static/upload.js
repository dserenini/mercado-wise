// Reduz a foto no próprio celular antes de enviar: mesmos limites do servidor
// (lado maior 2576 px, até 3,75 MP). Uma foto de 5 MB vira ~300 KB, o upload fica
// rápido no 4G e cabe no limite de requisição da hospedagem.
const MAX_EDGE = 2576;
const MAX_PIXELS = 3_750_000;

const form = document.getElementById("upload-form");
const input = form.querySelector('input[type="file"]');
const list = document.getElementById("upload-list");
const done = document.getElementById("upload-done");

// Várias fotos: envia uma por vez (cada envio leva 1–2 s; a leitura de cada nota
// roda depois, no servidor). Cada foto ganha uma linha com o resultado.
input.addEventListener("change", async () => {
  const files = [...(input.files ?? [])];
  if (files.length === 0) return;
  form.setAttribute("aria-busy", "true");
  input.disabled = true;
  done.hidden = true;
  list.replaceChildren();

  let rejected = 0;
  for (const file of files) {
    const row = document.createElement("li");
    row.textContent = `${file.name}: enviando…`;
    list.append(row);
    const result = await send(file);
    row.replaceChildren(...describe(file.name, result));
    if (result.kind !== "queued") rejected += 1;
  }

  form.removeAttribute("aria-busy");
  input.disabled = false;
  input.value = "";
  done.hidden = false;
  // Tudo aceito: vai para a lista, onde as notas aparecem como "lendo…".
  if (rejected === 0) setTimeout(() => location.assign("/"), 800);
});

async function send(file, url = form.action, fields = {}) {
  try {
    // Se o navegador não conseguir decodificar a imagem, vai a original.
    const photo = await shrink(file).catch(() => file);
    const body = new FormData();
    // Campos antes da foto: o servidor já os tem quando recebe o arquivo.
    for (const [k, v] of Object.entries(fields)) body.append(k, v);
    body.append("photo", photo, "nota.jpg");
    const res = await fetch(url, {
      method: "POST",
      body,
      headers: { Accept: "application/json" },
    });
    const json = await res.json().catch(() => null);
    if (json?.results) return json.results[0];
    if (json?.kind) return json;
    return { kind: "error", message: `erro ${res.status}` };
  } catch (error) {
    return { kind: "error", message: `sem conexão (${error.message})` };
  }
}

function describe(name, result) {
  const link = (id) => {
    const a = document.createElement("a");
    a.href = `/receipts/${id}`;
    a.textContent = `#${id}`;
    return a;
  };
  if (result.kind === "queued")
    return [`✓ ${name}: enviada, lendo… (nota `, link(result.id), ")"];
  if (result.kind === "same-photo")
    return [`⟳ ${name}: foto repetida, já é a nota `, link(result.id)];
  return [`✗ ${name}: ${result.message}`];
}

async function shrink(file) {
  // from-image: aplica a rotação EXIF da câmera antes de desenhar.
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  const scale = Math.min(
    1,
    MAX_EDGE / Math.max(bitmap.width, bitmap.height),
    Math.sqrt(MAX_PIXELS / (bitmap.width * bitmap.height)),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(bitmap.width * scale);
  canvas.height = Math.floor(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("conversão falhou"))),
      "image/jpeg",
      0.9,
    ),
  );
}

// Uma nota com várias fotos: a geral cria a nota (sem começar a ler), cada foto de
// perto vai numa requisição, e no fim pede a leitura.
const noteForm = document.getElementById("note-form");
const mainInput = document.getElementById("main-photo");
const closeInput = document.getElementById("close-ups");
const closeButton = document.getElementById("close-up-button");
const sendButton = document.getElementById("send-note");
const noteStatus = document.getElementById("note-status");
let main = null;
const closeUps = [];

function thumb(file, onRemove) {
  const figure = document.createElement("figure");
  const img = document.createElement("img");
  img.src = URL.createObjectURL(file);
  img.alt = "";
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "secondary outline";
  remove.textContent = "×";
  remove.setAttribute("aria-label", "Tirar esta foto");
  remove.addEventListener("click", () => {
    URL.revokeObjectURL(img.src);
    figure.remove();
    onRemove();
  });
  figure.append(img, remove);
  return figure;
}

mainInput.addEventListener("change", () => {
  const file = mainInput.files?.[0];
  mainInput.value = "";
  if (!file) return;
  main = file;
  document.getElementById("main-thumb").replaceChildren(
    thumb(file, () => {
      main = null;
      sendButton.hidden = true;
    }),
  );
  closeButton.hidden = false;
  sendButton.hidden = false;
});

closeInput.addEventListener("change", () => {
  for (const file of closeInput.files ?? []) {
    if (closeUps.length >= 8) {
      noteStatus.textContent = "Até 8 fotos de perto por nota.";
      break;
    }
    closeUps.push(file);
    document
      .getElementById("close-up-thumbs")
      .append(thumb(file, () => closeUps.splice(closeUps.indexOf(file), 1)));
  }
  closeInput.value = "";
});

noteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!main) return;
  noteForm.setAttribute("aria-busy", "true");
  sendButton.disabled = true;
  const wait = closeUps.length > 0 ? { wait: "1" } : {};
  noteStatus.textContent = "Enviando a foto da nota…";
  const result = await send(main, noteForm.action, wait);
  if (result.kind !== "queued") {
    noteStatus.replaceChildren(...describe("Foto da nota", result));
    noteForm.removeAttribute("aria-busy");
    sendButton.disabled = false;
    return;
  }
  let failed = 0;
  for (const [i, file] of closeUps.entries()) {
    noteStatus.textContent = `Enviando foto de perto ${i + 1} de ${closeUps.length}…`;
    const r = await send(file, `/receipts/${result.id}/photos`);
    if (r.kind !== "added") failed += 1;
  }
  if (wait.wait)
    await fetch(`/receipts/${result.id}/read`, { method: "POST" }).catch(
      () => {},
    );
  noteStatus.textContent = failed
    ? `Nota enviada, mas ${failed} foto(s) de perto não foram. Lendo…`
    : "Nota enviada. Lendo…";
  setTimeout(() => location.assign(`/receipts/${result.id}`), 800);
});
