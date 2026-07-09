// Gera os ícones PNG/ICO do PWA a partir dos SVGs em public/.
// Uso: npm run icons
import sharp from "sharp";
import pngToIco from "png-to-ico";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pub = (p) => resolve(root, "public", p);

const any = readFileSync(pub("icon.svg"));
const maskable = readFileSync(pub("icon-maskable.svg"));

const png = (svg, size) =>
  sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();

async function main() {
  // Ícones principais do manifest
  await sharp(any, { density: 384 }).resize(192, 192).png().toFile(pub("pwa-192x192.png"));
  await sharp(any, { density: 384 }).resize(512, 512).png().toFile(pub("pwa-512x512.png"));
  // Maskable (Android adaptive)
  await sharp(maskable, { density: 384 }).resize(512, 512).png().toFile(pub("maskable-512x512.png"));
  // Apple touch icon (iOS tela inicial) — sem transparência
  await sharp(any, { density: 384 }).resize(180, 180).png().toFile(pub("apple-touch-icon.png"));
  // Favicon multi-resolução
  const ico = await pngToIco([await png(any, 32), await png(any, 48), await png(any, 64)]);
  writeFileSync(pub("favicon.ico"), ico);
  console.log("Ícones gerados em public/.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
