// Uso: npm run add-user -- <nome>
// Cria o usuário com a senha digitada, ou troca a senha se ele já existe. Só o hash
// vai para o banco. Para produção: node --env-file=.env.production --import tsx
// scripts/add-user.ts <nome>
import { createInterface } from "node:readline/promises";
import { hashPassword } from "../src/auth/password.js";
import { connect } from "../src/db/connect.js";
import { saveUser, USERNAME } from "../src/db/users-repo.js";

const username = (process.argv[2] ?? "").trim().toLowerCase();
if (!USERNAME.test(username)) {
  console.error(
    "Uso: npm run add-user -- <nome> (minúsculas, números e . _ -, 2 a 32)",
  );
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const password = await rl.question(`Senha de ${username} (mínimo 8): `);
rl.close();
if (password.length < 8) {
  console.error("Senha curta demais.");
  process.exit(1);
}

const db = connect();
try {
  const created = await saveUser(db, username, await hashPassword(password));
  console.log(
    created ? `Usuário ${username} criado.` : `Senha de ${username} trocada.`,
  );
} finally {
  await db.close();
}
