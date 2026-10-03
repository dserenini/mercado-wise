// Tela de revisão: soma ao vivo (itens − descontos × total da nota), conta de cada
// linha, incluir e remover itens. O servidor valida tudo de novo ao salvar.
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

recalc();
