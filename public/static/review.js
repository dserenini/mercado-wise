// Tela de revisão: soma ao vivo (itens − descontos, inclusive o que a nota só traz no
// total × total da nota), conta de cada
// linha, incluir e remover itens, e sugestões da memória (autocompletar). O servidor
// valida tudo de novo ao salvar.
const form = document.getElementById("review-form");
const items = document.getElementById("items");
const template = document.getElementById("new-item");
let newCount = 0;

// "1.234,56" → 1234.56; vazio ou inválido → null
function parse(text) {
  const clean = (text || "").replace(/R\$|\s/g, "");
  if (!clean) return null;
  const n = Number(
    clean.includes(",") ? clean.replace(/\./g, "").replace(",", ".") : clean,
  );
  return Number.isFinite(n) ? n : null;
}
const cents = (text) => {
  const n = parse(text);
  return n === null ? null : Math.round(n * 100);
};
const brl = (c) =>
  `${c < 0 ? "-" : ""}R$ ${(Math.abs(c) / 100).toFixed(2).replace(".", ",")}`;

function recalc() {
  let sum = 0;
  let itemDiscounts = 0;
  for (const item of items.querySelectorAll("[data-item]")) {
    const field = (attr) => item.querySelector(`[${attr}]`).value;
    const total = cents(field("data-line-total"));
    const discount = cents(field("data-discount")) ?? 0;
    sum += (total ?? 0) - discount;
    itemDiscounts += discount;
    // conta da linha: qtd × preço deve dar o total (menos de 1 centavo de folga)
    const qty = parse(field("data-qty"));
    const price = cents(field("data-price"));
    const wrong =
      qty !== null &&
      price !== null &&
      total !== null &&
      Math.abs(qty * price - total) >= 1;
    item.classList.toggle("line-mismatch", wrong);
  }
  const printed = cents(form.querySelector("[data-total]").value);
  const bar = document.getElementById("totals");
  // Desconto que a nota só traz no total (ex.: página da SEFAZ, que não detalha por
  // item): o que passar dos descontos dos itens também sai da soma.
  const extra = Math.max(0, Number(bar.dataset.discountTotal) - itemDiscounts);
  sum -= extra;
  bar.querySelector("[data-extra-wrap]").hidden = extra === 0;
  bar.querySelector("[data-extra]").textContent = brl(-extra);
  bar.querySelector("[data-sum]").textContent = brl(sum);
  bar.querySelector("[data-printed]").textContent =
    printed === null ? "—" : brl(printed);
  bar.querySelector("[data-diff]").textContent =
    printed === null ? "—" : brl(printed - sum);
  bar.classList.toggle("ok", printed === sum);
  bar.classList.toggle("bad", printed !== null && printed !== sum);
}

form.addEventListener("input", recalc);

// Expandir / recolher todos os itens de uma vez.
for (const button of document.querySelectorAll("[data-open-all]")) {
  button.addEventListener("click", () => {
    for (const item of items.querySelectorAll("[data-item]")) {
      item.open = Boolean(button.dataset.openAll);
    }
  });
}

document.getElementById("add-item").addEventListener("click", () => {
  newCount += 1;
  const html = template.innerHTML.replaceAll("__KEY__", `n${newCount}`);
  items.insertAdjacentHTML("beforeend", html);
  items.lastElementChild.querySelector("input").focus();
  recalc();
});

items.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove]");
  if (!button) return;
  button.closest("[data-item]").remove();
  recalc();
});

// Campo obrigatório dentro de item (ou de "Mais campos") fechado: abre tudo em volta
// para o navegador mostrar o erro.
form.addEventListener(
  "invalid",
  (event) => {
    for (let d = event.target.closest("details"); d; ) {
      d.open = true;
      d = d.parentElement.closest("details");
    }
  },
  true,
);

// Conta que falta: com quantidade e preço, completa o total vazio; com quantidade e
// total, completa o preço vazio.
items.addEventListener("change", (event) => {
  if (!event.target.matches("[data-qty], [data-price], [data-line-total]"))
    return;
  const item = event.target.closest("[data-item]");
  const [qty, price, total] = [
    "[data-qty]",
    "[data-price]",
    "[data-line-total]",
  ].map((sel) => item.querySelector(sel));
  const q = parse(qty.value);
  if (!q) return;
  const money = (c) => (c / 100).toFixed(2).replace(".", ",");
  if (cents(price.value) !== null && total.value.trim() === "")
    total.value = money(Math.round(q * cents(price.value)));
  else if (cents(total.value) !== null && price.value.trim() === "")
    price.value = money(Math.round(cents(total.value) / q));
  recalc();
});

// "Pronto": fecha o item e atualiza o resumo. Item do topo ("Faltou informação")
// que ficou com produto, quantidade, preço e total vira ✓. A nota é salva no fim,
// em "Confirmar nota".
items.addEventListener("click", (event) => {
  const button = event.target.closest("[data-done]");
  if (!button) return;
  const item = button.closest("[data-item]");
  const field = (sel) => item.querySelector(sel).value.trim();
  const qty = field("[data-qty]");
  const total = cents(field("[data-line-total]"));
  item.querySelector(".item-total").innerHTML = "";
  item.querySelector(".item-total").append(
    Object.assign(document.createElement("small"), {
      textContent: `${qty || "?"} × `,
    }),
    total === null ? "?" : brl(total),
  );
  const product = field('[data-fill="product"]');
  const brand = field('[data-fill="brand"]');
  const variant = field('[data-fill="variant"]');
  if (product)
    item.querySelector(".item-title strong").textContent = [
      product,
      brand,
      variant,
    ]
      .filter(Boolean)
      .join(" · ");
  const complete =
    product &&
    parse(qty) !== null &&
    cents(field("[data-price]")) !== null &&
    total !== null;
  if (complete && item.closest("[data-to-fix]")) {
    item.classList.remove("status-warning", "status-error", "status-none");
    item.classList.add("status-ok");
    item.querySelector(".item-status").textContent = "✓";
    const left = [
      ...document.querySelectorAll("[data-to-fix] [data-item]:not(.status-ok)"),
    ].length;
    document.querySelector("[data-to-fix-count]").textContent = left;
  }
  item.open = false;
  item.scrollIntoView({ block: "nearest" });
});

// ---------------------------------------------------------------------------
// Sugestões da memória. "Na nota": a lista vem do que já foi confirmado; escolher
// uma opção preenche produto, marca, variante, embalagem e categoria. EAN/código
// interno: se a memória conhece o código, completa só os campos vazios. Campos
// preenchidos assim ficam destacados até o usuário mexer neles.
// ---------------------------------------------------------------------------
const cnpj = form.dataset.cnpj || "";
const datalist = document.getElementById("item-suggestions");
let suggestions = [];
let pending = null;
let timer = null;

const decimal = (n) => (n === null ? "" : String(n).replace(".", ","));

function fill(item, found, { onlyEmpty }) {
  const values = { ...found, package_size: decimal(found.package_size) };
  const fields = [...item.querySelectorAll("[data-fill]")];
  const desc = item.querySelector("[data-desc]");
  if (!desc.value && found.raw_description) fields.push(desc);
  for (const field of fields) {
    const key = field.dataset.fill ?? "raw_description";
    const value = values[key] ?? "";
    if (onlyEmpty && field.value !== "") continue;
    if (field.value === value) continue;
    field.value = value;
    field.classList.add("suggested");
  }
}

async function fetchJson(url) {
  pending?.abort();
  pending = new AbortController();
  try {
    const res = await fetch(url, { signal: pending.signal });
    return res.ok ? await res.json() : null;
  } catch {
    return null; // abortada (o usuário continuou digitando) ou sem rede
  }
}

function loadSuggestions(text) {
  clearTimeout(timer);
  if (text.trim().length < 2) return;
  timer = setTimeout(async () => {
    const params = new URLSearchParams({ q: text, cnpj });
    const found = await fetchJson(`/suggest/items?${params}`);
    if (!found) return;
    suggestions = found;
    datalist.replaceChildren(
      ...found.map((s) => {
        const option = document.createElement("option");
        option.value = s.raw_description;
        option.label = [s.product, s.brand, s.variant]
          .filter(Boolean)
          .join(" · ");
        return option;
      }),
    );
  }, 200);
}

items.addEventListener("input", (event) => {
  const field = event.target;
  field.classList.remove("suggested", "derived");
  if (!field.matches("[data-desc]")) return;
  // Escolha na lista chega sem inputType (ou "insertReplacementText"); digitação, não.
  const picked =
    !event.inputType || event.inputType === "insertReplacementText";
  const match =
    picked && suggestions.find((s) => s.raw_description === field.value);
  if (match) fill(field.closest("[data-item]"), match, { onlyEmpty: false });
  else loadSuggestions(field.value);
});

items.addEventListener("change", async (event) => {
  const field = event.target;
  if (!field.matches("[data-code]")) return;
  const item = field.closest("[data-item]");
  const [ean, code] = [...item.querySelectorAll("[data-code]")].map(
    (f) => f.value,
  );
  if (!ean && !code) return;
  const params = new URLSearchParams({ ean, store_code: code, cnpj });
  const found = await fetchJson(`/suggest/code?${params}`);
  if (found) fill(item, found, { onlyEmpty: true });
});

// ---------------------------------------------------------------------------
// Linhas iguais na mesma nota (mesmo EAN ou, sem EAN, mesma descrição): corrigir o
// produto de uma copia a correção para as outras que o usuário ainda não mexeu. As
// cópias ficam destacadas e vão marcadas (copied) para não contarem como digitadas.
// ---------------------------------------------------------------------------
function sameKey(item) {
  const ean = item.querySelector("[data-code]").value.trim();
  if (ean) return `ean:${ean}`;
  const desc = item
    .querySelector("[data-desc]")
    .value.trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
  return desc ? `desc:${desc}` : null;
}

items.addEventListener("input", (event) => {
  if (!event.target.matches("[data-fill]")) return;
  const item = event.target.closest("[data-item]");
  item.dataset.touched = "1";
  item.querySelector("[data-copied]").value = "";
});

items.addEventListener("change", (event) => {
  if (!event.target.matches("[data-fill]")) return;
  const source = event.target.closest("[data-item]");
  const key = sameKey(source);
  if (!key) return;
  const values = new Map(
    [...source.querySelectorAll("[data-fill]")].map((f) => [
      f.dataset.fill,
      f.value,
    ]),
  );
  for (const other of items.querySelectorAll("[data-item]")) {
    if (other === source || other.dataset.touched) continue;
    if (sameKey(other) !== key) continue;
    let changed = false;
    for (const field of other.querySelectorAll("[data-fill]")) {
      const value = values.get(field.dataset.fill) ?? "";
      if (field.value === value) continue;
      field.value = value;
      field.classList.add("suggested");
      field.title = "Copiado da linha igual desta nota";
      changed = true;
    }
    if (changed) other.querySelector("[data-copied]").value = "1";
  }
});

// ---------------------------------------------------------------------------
// Conta da linha (mesma regra de src/services/derive.ts): com dois de quantidade,
// preço e total, o terceiro vazio é calculado — só quando a resposta é única. O
// total impresso de item pesado vem truncado ou arredondado, por isso a busca.
// ---------------------------------------------------------------------------
const printedTotals = (q, p) =>
  new Set([Math.floor(q * p + 1e-6), Math.round(q * p)]);

function lineMath(q, p, t, kg) {
  if (t === null && q > 0 && p !== null) {
    const options = [...printedTotals(q, p)];
    return options.length === 1 ? { field: "total", value: options[0] } : null;
  }
  if (q === null && p > 0 && t > 0) {
    if (!kg)
      return Number.isInteger(t / p) ? { field: "qty", value: t / p } : null;
    const found = [];
    const lo = Math.floor(((t - 1) / p) * 1000);
    for (let g = lo; g <= Math.ceil(((t + 1) / p) * 1000); g++)
      if (g > 0 && printedTotals(g / 1000, p).has(t)) found.push(g / 1000);
    return found.length === 1 ? { field: "qty", value: found[0] } : null;
  }
  if (p === null && q > 0 && t > 0) {
    if (!kg)
      return Number.isInteger(t / q) ? { field: "price", value: t / q } : null;
    const found = [];
    for (let c = Math.floor((t - 1) / q); c <= Math.ceil((t + 1) / q); c++)
      if (c > 0 && printedTotals(q, c).has(t)) found.push(c);
    return found.length === 1 ? { field: "price", value: found[0] } : null;
  }
  return null;
}

const centsText = (c) => (c / 100).toFixed(2).replace(".", ",");

items.addEventListener("change", (event) => {
  if (!event.target.matches("[data-qty], [data-price], [data-line-total]"))
    return;
  const item = event.target.closest("[data-item]");
  const inputs = {
    qty: item.querySelector("[data-qty]"),
    price: item.querySelector("[data-price]"),
    total: item.querySelector("[data-line-total]"),
  };
  const kg = /^kg$/i.test(item.querySelector("[data-unit]").value.trim());
  const found = lineMath(
    parse(inputs.qty.value),
    cents(inputs.price.value),
    cents(inputs.total.value),
    kg,
  );
  if (!found) return;
  const input = inputs[found.field];
  input.value =
    found.field === "qty"
      ? String(found.value).replace(".", ",")
      : centsText(found.value);
  input.classList.add("derived");
  input.title = "Calculado pela conta da linha";
  recalc();
});

recalc();
