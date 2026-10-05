import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client.js";
import { listReceipts, saveDraft } from "../src/db/receipts-repo.js";
import {
  dateBounds,
  filterQuery,
  groupByMonth,
  parseListFilter,
  valueBounds,
} from "../src/routes/list-filter.js";
import { validateReceipt } from "../src/services/validators.js";
import { testDb } from "./helpers/db.js";
import { item, receipt } from "./helpers/receipt.js";

describe("valueBounds", () => {
  it.each([
    ["66", [6600, 6699]], // inteiro = o real inteiro
    ["66,13", [6613, 6613]], // com centavos = exato
    ["66,1", [6610, 6610]],
    ["R$ 10", [1000, 1099]],
    ["abc", null],
    ["", null],
  ])("%s → %j", (text, bounds) => {
    expect(valueBounds(text)).toEqual(bounds);
  });
});

describe("dateBounds", () => {
  it.each([
    ["2026", ["2026-01-01", "2026-12-31"]],
    ["2026-02", ["2026-02-01", "2026-02-28"]],
    ["2024-02", ["2024-02-01", "2024-02-29"]],
    ["2026-08-23", ["2026-08-23", "2026-08-23"]],
    ["2026-02-30", null],
    ["2026-13", null],
    ["ontem", null],
  ])("%s → %j", (text, bounds) => {
    expect(dateBounds(text)).toEqual(bounds);
  });
});

describe("parseListFilter", () => {
  it("sem nada: todas, por data", () => {
    const { filter, active } = parseListFilter({});
    expect(filter).toEqual({
      status: null,
      minCents: null,
      maxCents: null,
      fromDate: null,
      toDate: null,
      order: { date: "desc", value: null },
    });
    expect(active).toBe(0);
  });

  it("só 'de' = aquele valor e aquela data; com 'até' = faixa", () => {
    expect(
      parseListFilter({ de: "66", data_de: "2026-08" }).filter,
    ).toMatchObject({
      minCents: 6600,
      maxCents: 6699,
      fromDate: "2026-08-01",
      toDate: "2026-08-31",
    });
    const { filter, active } = parseListFilter({
      status: "confirmed",
      de: "50",
      ate: "100,00",
      data_de: "2025",
      data_ate: "2026-03",
      ordem_data: "nenhuma",
      ordem_valor: "caras",
    });
    expect(filter).toEqual({
      status: "confirmed",
      minCents: 5000,
      maxCents: 10000,
      fromDate: "2025-01-01",
      toDate: "2026-03-31",
      order: { date: null, value: "desc" },
    });
    expect(active).toBe(3); // status, valor, data
  });

  it("ignora o que não faz sentido em vez de dar erro", () => {
    const { filter, form } = parseListFilter({
      status: "x",
      de: "abc",
      data_de: "2026-13",
      ate: ["1", "2"],
      ordem_data: "drop table",
      ordem_valor: "x",
    });
    expect(filter).toMatchObject({
      status: null,
      minCents: null,
      maxCents: null,
      fromDate: null,
      order: { date: "desc", value: null },
    });
    expect(form.de).toBe("");
  });

  it("filterQuery devolve só os filtros preenchidos (sem os padrões)", () => {
    const { form } = parseListFilter({
      status: "draft",
      de: "10,5",
      data_de: "",
      ordem_data: "novas",
    });
    expect(filterQuery(form)).toBe("status=draft&de=10%2C5");
    expect(
      filterQuery(
        parseListFilter({ ordem_data: "antigas", ordem_valor: "baratas" }).form,
      ),
    ).toBe("ordem_data=antigas&ordem_valor=baratas");
  });
});

describe("listReceipts com filtros", () => {
  let db: Db;
  beforeEach(async () => {
    db = await testDb();
    const notes: [string, number][] = [
      ["2026-08-23", 66.13],
      ["2026-08-16", 223.2],
      ["2025-08-10", 10],
      ["2026-07-15", 16.49],
    ];
    for (const [date, total] of notes) {
      const r = receipt({
        access_key: null,
        purchase_date: date,
        total,
        items: [item({ unit_price: total, total_price: total })],
      });
      await saveDraft(db, {
        receipt: r,
        validation: validateReceipt(r),
        interpreted: [null],
        calls: { read: null, interpret: null },
      });
    }
    await db.query(
      "update app.receipts set status = 'confirmed' where total_cents = 22320",
    );
  });
  afterEach(async () => {
    await db.close();
  });

  const totals = async (query: Record<string, string>) =>
    (await listReceipts(db, parseListFilter(query).filter)).map(
      (r) => r.total_cents,
    );

  it("padrão: data mais recente primeiro", async () => {
    expect(await totals({})).toEqual([6613, 22320, 1649, 1000]);
  });

  it("status", async () => {
    expect(await totals({ status: "confirmed" })).toEqual([22320]);
  });

  it("valor: só 'de' (real inteiro ou exato) e faixa", async () => {
    expect(await totals({ de: "66" })).toEqual([6613]);
    expect(await totals({ de: "66,13" })).toEqual([6613]);
    expect(await totals({ de: "66,10" })).toEqual([]);
    expect(await totals({ de: "15", ate: "100" })).toEqual([6613, 1649]);
  });

  it("data: ano, mês, dia e faixa", async () => {
    expect(await totals({ data_de: "2026" })).toEqual([6613, 22320, 1649]);
    expect(await totals({ data_de: "2026-08" })).toEqual([6613, 22320]);
    expect(await totals({ data_de: "2026-08-16" })).toEqual([22320]);
    expect(await totals({ data_de: "2025-08", data_ate: "2026-07" })).toEqual([
      1649, 1000,
    ]);
  });

  it("ordena só por data", async () => {
    expect(await totals({ ordem_data: "antigas" })).toEqual([
      1000, 1649, 22320, 6613,
    ]);
  });

  it("ordena só por valor", async () => {
    const valor = { ordem_data: "nenhuma" };
    expect(await totals({ ...valor, ordem_valor: "caras" })).toEqual([
      22320, 6613, 1649, 1000,
    ]);
    expect(await totals({ ...valor, ordem_valor: "baratas" })).toEqual([
      1000, 1649, 6613, 22320,
    ]);
  });

  it("data e valor: meses agrupados, valor dentro do mês", async () => {
    const query = { ordem_data: "novas", ordem_valor: "baratas" };
    const { filter } = parseListFilter(query);
    const receipts = await listReceipts(db, filter);
    expect(receipts.map((r) => r.total_cents)).toEqual([
      6613, 22320, 1649, 1000,
    ]);
    const groups = groupByMonth(receipts, filter.order);
    expect(groups.map((g) => [g.label, g.totalCents])).toEqual([
      ["Agosto de 2026", 28933],
      ["Julho de 2026", 1649],
      ["Agosto de 2025", 1000],
    ]);
    expect(
      await totals({ ordem_data: "antigas", ordem_valor: "caras" }),
    ).toEqual([1000, 1649, 22320, 6613]);
  });

  it("sem os dois critérios, a lista não é agrupada", () => {
    expect(
      groupByMonth([], { date: "desc", value: null })[0]?.label,
    ).toBeNull();
  });
});
