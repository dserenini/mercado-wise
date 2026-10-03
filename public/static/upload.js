// Reduz a foto no próprio celular antes de enviar: mesmos limites do servidor
// (lado maior 2576 px, até 3,75 MP). Uma foto de 5 MB vira ~300 KB, o upload fica
// rápido no 4G e cabe no limite de requisição da hospedagem.
const MAX_EDGE = 2576;
const MAX_PIXELS = 3_750_000;

const form = document.getElementById("upload-form");
const input = form.querySelector('input[type="file"]');
const status = document.getElementById("upload-status");

input.addEventListener("change", async () => {
  const file = input.files?.[0];
  if (!file) return;
  form.setAttribute("aria-busy", "true");
  status.textContent = "Preparando a foto…";
  try {
    // Se o navegador não conseguir decodificar a imagem, vai a original.
    const photo = await shrink(file).catch(() => file);
    const body = new FormData();
    body.append("photo", photo, "nota.jpg");
    status.textContent =
      "Lendo a nota… pode levar até 1 minuto. Não feche esta tela.";
    const res = await fetch(form.action, { method: "POST", body });
    if (res.redirected) {
      location.href = res.url;
      return;
    }
    // Duplicata ou erro: o servidor devolveu uma página; mostra ela.
    document.open();
    document.write(await res.text());
    document.close();
  } catch (error) {
    form.removeAttribute("aria-busy");
    status.textContent = `Falhou: ${error.message}. Verifique a conexão e tente de novo.`;
  }
});

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
