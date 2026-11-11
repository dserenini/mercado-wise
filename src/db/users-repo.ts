import type { Db } from "./client.js";

export interface User {
  id: number;
  username: string;
  /** null: entra com a senha única de antes (APP_PASSWORD_HASH) */
  password_hash: string | null;
}

/** Nome de usuário válido: minúsculas, números e . _ - (2 a 32). */
export const USERNAME = /^[a-z0-9._-]{2,32}$/;

export async function findUser(db: Db, username: string): Promise<User | null> {
  const [user] = await db.query<User>(
    "select id, username, password_hash from app.users where username = $1",
    [username],
  );
  return user ?? null;
}

/** Todos, por nome (filtro "de quem" da lista). */
export async function listUsers(
  db: Db,
): Promise<{ id: number; username: string }[]> {
  return db.query("select id, username from app.users order by username");
}

/** Cria o usuário ou troca a senha dele. Devolve se foi criado. */
export async function saveUser(
  db: Db,
  username: string,
  passwordHash: string,
): Promise<boolean> {
  const [row] = await db.query<{ created: boolean }>(
    `insert into app.users (username, password_hash) values ($1, $2)
     on conflict (username) do update set password_hash = excluded.password_hash
     returning (xmax = 0) as created`,
    [username, passwordHash],
  );
  return row?.created ?? false;
}
