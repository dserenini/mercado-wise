import { expect, it } from "vitest";
import { freshDb, testDb } from "./helpers/db.js";

// O banco dos testes é compartilhado e zerado a cada testDb(): tem que voltar
// exatamente ao estado de um banco recém-migrado.
it("testDb() volta ao estado de recém-migrado", async () => {
  const insert =
    "insert into app.receipts (source, status) values ('photo', 'draft') returning id";
  const users = "select id, username from app.users order by id";

  const fresh = await freshDb();
  const [expectedId] = await fresh.query(insert);
  const expectedUsers = await fresh.query(users);
  await fresh.close();

  const db = await testDb();
  await db.query(insert);
  await db.query("insert into app.users (username) values ('outro')");

  const again = await testDb();
  expect(await again.query("select id from app.receipts")).toEqual([]);
  expect(await again.query(users)).toEqual(expectedUsers);
  expect(await again.query(insert)).toEqual([expectedId]);
});
