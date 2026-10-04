// Tela de revisão: soma ao vivo (itens − descontos × total da nota), conta de cada
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
  for (const item of items.querySelectorAll("[data-item]")) {
    const field = (attr) => item.querySelector(`[${attr}]`).value;
    const total = cents(field("data-line-total"));
    sum += (total ?? 0) - (cents(field("data-discount")) ?? 0);
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
  bar.querySelector("[data-sum]").textContent = brl(sum);
  bar.querySelector("[data-printed]").textContent =
    printed === null ? "—" : brl(printed);
  bar.querySelector("[data-diff]").textContent =
    printed === null ? "—" : brl(printed - sum);
  bar.classList.toggle("ok", printed === sum);
  bar.classList.toggle("bad", printed !== null && printed !== sum);
}

form.addEventListener("input", recalc);

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

// Campo obrigatório dentro de item fechado: abre o item para o navegador mostrar o erro.
form.addEventListener(
  "invalid",
  (event) => {
    const item = event.target.closest("details");
    if (item) item.open = true;
  },
  true,
);

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
