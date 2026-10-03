// Uso: npm run setup-login
// Pede a senha do app e imprime as duas linhas para colar no .env:
// APP_PASSWORD_HASH (só o hash, nunca a senha) e SESSION_SECRET (aleatório).
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { hashPassword } from "../src/auth/password.js";

const rl = createInterface({ input: process.stdin, output: process.stdout });
const password = await rl.question("Senha do app (mínimo 8 caracteres): ");
rl.close();
if (password.length < 8) {
  console.error("Senha curta demais.");
  process.exit(1);
}
console.log("\nCole no .env:\n");
console.log(`APP_PASSWORD_HASH=${await hashPassword(password)}`);
console.log(`SESSION_SECRET=${randomBytes(32).toString("hex")}`);
