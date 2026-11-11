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

async function send(file) {
  try {
    // Se o navegador não conseguir decodificar a imagem, vai a original.
    const photo = await shrink(file).catch(() => file);
    const body = new FormData();
    body.append("photo", photo, "nota.jpg");
    const res = await fetch(form.action, {
      method: "POST",
      body,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return { kind: "error", message: `erro ${res.status}` };
    const { results } = await res.json();
    return results[0];
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
