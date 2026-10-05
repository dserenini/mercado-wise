// Lista de notas: filtro aplicado ao vivo (busca a própria página com os filtros e
// troca só a lista), barra de valor com dois pontos e calendário que escolhe dia,
// mês ou ano inteiro. Os filtros ficam na URL; o servidor interpreta (list-filter.ts).
const form = document.getElementById("filter-form");
const results = document.getElementById("results");
const MONTHS = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];
const MONTHS_LONG = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

// ---------------------------------------------------------------------------
// Aplicar ao vivo
// ---------------------------------------------------------------------------
let pending = null;
let timer = null;

function query() {
  const params = new URLSearchParams();
  for (const [key, value] of new FormData(form)) {
    const v = String(value).trim();
    if (key === "status")
      params.append(key, v); // vários
    else if (v !== "" && !(key === "ordem_data" && v === "novas"))
      params.set(key, v);
  }
  return params.toString();
}

async function apply() {
  const url = `/?${query()}`;
  history.replaceState(null, "", url);
  pending?.abort();
  pending = new AbortController();
  try {
    const res = await fetch(url, { signal: pending.signal });
    if (!res.ok) return;
    const page = new DOMParser().parseFromString(await res.text(), "text/html");
    const fresh = page.getElementById("results");
    results.innerHTML = fresh.innerHTML;
    results.toggleAttribute("data-reading", fresh.hasAttribute("data-reading"));
    document.querySelector("[data-filter-count]").textContent =
      page.querySelector("[data-filter-count]").textContent;
  } catch {
    // abortada por uma busca mais nova, ou sem rede: a lista fica como estava
  }
}

function schedule(delay) {
  clearTimeout(timer);
  timer = setTimeout(apply, delay);
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  schedule(0);
});
form.addEventListener("change", (event) => {
  if (event.target.matches("[name=status]")) {
    statusSummary();
    schedule(300); // dá tempo de marcar mais de um
  } else if (event.target.matches("select, input[type=hidden]")) schedule(0);
});

// Texto do campo Status: "Todas", os nomes (até 2) ou "N selecionados".
function statusSummary() {
  const names = [...form.querySelectorAll("[name=status]:checked")].map((c) =>
    c.parentElement.textContent.trim(),
  );
  form.querySelector("[data-status-summary]").textContent =
    names.length === 0
      ? "Todas"
      : names.length <= 2
        ? names.join(", ")
        : `${names.length} selecionados`;
}
form.addEventListener("input", (event) => {
  if (event.target.matches("[name=de], [name=ate]")) {
    syncSlider();
    schedule(500);
  }
});

// ---------------------------------------------------------------------------
// Barra de valor (dois pontos). Arrastar preenche "de" e "até" (faixa); os dois
// nas pontas = sem filtro.
// ---------------------------------------------------------------------------
const rangeMin = form.querySelector("[data-range-min]");
const rangeMax = form.querySelector("[data-range-max]");
const inputDe = form.querySelector("[name=de]");
const inputAte = form.querySelector("[name=ate]");
// (não pode se chamar "top": é propriedade fixa de window)
const sliderTop = Number(rangeMax.max);

const reais = (text) => {
  const clean = (text || "").replace(/R\$|\s/g, "");
  if (!clean) return null;
  const n = Number(
    clean.includes(",") ? clean.replace(/\./g, "").replace(",", ".") : clean,
  );
  return Number.isFinite(n) ? n : null;
};

function paintSlider() {
  const lo = (Number(rangeMin.value) / sliderTop) * 100;
  const hi = (Number(rangeMax.value) / sliderTop) * 100;
  rangeMin.parentElement.style.setProperty("--lo", `${lo}%`);
  rangeMin.parentElement.style.setProperty("--hi", `${hi}%`);
}

function syncSlider() {
  const de = reais(inputDe.value);
  const ate = reais(inputAte.value);
  rangeMin.value = de === null ? 0 : Math.floor(de);
  rangeMax.value =
    ate === null ? (de === null ? sliderTop : Math.ceil(de)) : Math.ceil(ate);
  paintSlider();
}

function onSlide(event) {
  let lo = Number(rangeMin.value);
  let hi = Number(rangeMax.value);
  if (lo > hi) {
    if (event.target === rangeMin) lo = hi;
    else hi = lo;
    rangeMin.value = lo;
    rangeMax.value = hi;
  }
  const full = lo === 0 && hi === sliderTop;
  inputDe.value = full ? "" : String(lo);
  inputAte.value = full ? "" : String(hi);
  paintSlider();
  schedule(300);
}
rangeMin.addEventListener("input", onSlide);
rangeMax.addEventListener("input", onSlide);
syncSlider();

// ---------------------------------------------------------------------------
// Calendário: dias → (clique no mês) meses → (clique no ano) anos. Escolher um dia
// fecha; escolher um mês ou ano guarda o mês/ano inteiro e aproxima para refinar.
// Valor no campo escondido: "2026", "2026-08" ou "2026-08-23".
// ---------------------------------------------------------------------------
const firstYear = Number(form.dataset.firstYear);
const pad = (n) => String(n).padStart(2, "0");

function label(value) {
  const [y, m, d] = value.split("-");
  if (d) return `${d}/${m}/${y}`;
  if (m) return `${MONTHS[Number(m) - 1]}/${y}`;
  return y;
}

let picker = null; // { field, input, button, view, year, month, panel }

function closePicker() {
  picker?.panel.remove();
  picker = null;
}

function setValue(value) {
  const { input, button } = picker;
  input.value = value;
  button.textContent = value ? label(value) : button.dataset.placeholder;
  button.classList.toggle("filled", value !== "");
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function cell(text, onClick, classes = []) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = text;
  b.className = ["cal-btn", ...classes].filter(Boolean).join(" ");
  b.addEventListener("click", onClick);
  return b;
}

function render() {
  const { panel, view, year, month, input } = picker;
  const value = input.value;
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  panel.replaceChildren();

  // Cabeçalho: ‹  [mês] [ano]  ›
  const head = document.createElement("div");
  head.className = "cal-head";
  const step = (delta) => () => {
    if (picker.view === "days") {
      const d = new Date(picker.year, picker.month + delta, 1);
      picker.year = d.getFullYear();
      picker.month = d.getMonth();
    } else if (picker.view === "months") picker.year += delta;
    else picker.year += delta * 12;
    render();
  };
  head.append(cell("‹", step(-1), ["cal-nav"]));
  if (view === "days")
    head.append(
      cell(MONTHS_LONG[month], () => {
        picker.view = "months";
        render();
      }, ["cal-title"]),
    );
  head.append(
    cell(String(year), () => {
      picker.view = "years";
      render();
    }, ["cal-title"]),
  );
  head.append(cell("›", step(1), ["cal-nav"]));
  panel.append(head);

  const grid = document.createElement("div");
  grid.className = `cal-grid cal-${view}`;

  if (view === "days") {
    for (const w of ["D", "S", "T", "Q", "Q", "S", "S"]) {
      const span = document.createElement("span");
      span.className = "cal-weekday";
      span.textContent = w;
      grid.append(span);
    }
    const first = new Date(year, month, 1).getDay();
    for (let i = 0; i < first; i++) grid.append(document.createElement("span"));
    const days = new Date(year, month + 1, 0).getDate();
    for (let d = 1; d <= days; d++) {
      const key = `${year}-${pad(month + 1)}-${pad(d)}`;
      grid.append(
        cell(String(d), () => {
          setValue(key);
          closePicker();
        }, [key === todayKey && "today", key === value && "selected"]),
      );
    }
  } else if (view === "months") {
    MONTHS.forEach((m, i) => {
      const key = `${year}-${pad(i + 1)}`;
      grid.append(
        cell(m, () => {
          setValue(key);
          picker.month = i;
          picker.view = "days";
          render();
        }, [
          key === todayKey.slice(0, 7) && "today",
          key === value && "selected",
        ]),
      );
    });
  } else {
    const start = year - 11;
    for (let y = start; y <= year; y++) {
      grid.append(
        cell(String(y), () => {
          setValue(String(y));
          picker.year = y;
          picker.view = "months";
          render();
        }, [
          y === today.getFullYear() && "today",
          String(y) === value && "selected",
          y < firstYear && "muted",
        ]),
      );
    }
  }
  panel.append(grid);

  const foot = document.createElement("div");
  foot.className = "cal-foot";
  foot.append(
    cell("Limpar", () => {
      setValue("");
      closePicker();
    }, ["secondary", "outline"]),
    cell("Fechar", closePicker, ["secondary"]),
  );
  panel.append(foot);
}

for (const field of form.querySelectorAll("[data-date-field]")) {
  const input = field.querySelector("input");
  const button = field.querySelector("button");
  if (input.value) {
    button.textContent = label(input.value);
    button.classList.add("filled");
  }
  button.addEventListener("click", () => {
    const reopen = picker?.field !== field;
    closePicker();
    if (!reopen) return;
    // Abre no valor escolhido ou, sem valor, no mês de hoje.
    const [y, m] = input.value.split("-").map(Number);
    const now = new Date();
    const panel = document.createElement("div");
    panel.className = "calendar";
    // Cliques dentro do calendário redesenham o painel; não podem fechá-lo.
    panel.addEventListener("click", (e) => e.stopPropagation());
    field.append(panel);
    picker = {
      field,
      input,
      button,
      panel,
      view: input.value && !m ? "months" : "days",
      year: y || now.getFullYear(),
      month: m ? m - 1 : y ? 0 : now.getMonth(),
    };
    render();
  });
}

document.addEventListener("click", (event) => {
  if (picker && !picker.field.contains(event.target)) closePicker();
  // Fecha a lista de status ao clicar fora dela.
  const dropdown = form.querySelector("[data-status-dropdown]");
  if (dropdown.open && !dropdown.contains(event.target)) dropdown.open = false;
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closePicker();
});

// Enquanto houver nota sendo lida, atualiza a lista a cada 5 s (para quando todas
// terminarem: o servidor deixa de marcar data-reading).
setInterval(async () => {
  if (results.hasAttribute("data-reading") && !picker) await apply();
}, 5000);

// "Limpar filtros": zera tudo sem recarregar a página.
form.querySelector("[data-clear]").addEventListener("click", (event) => {
  event.preventDefault();
  form.reset();
  for (const el of form.querySelectorAll(
    "input[name]:not([type=checkbox]), select",
  ))
    el.value = "";
  for (const box of form.querySelectorAll("[name=status]")) box.checked = false;
  statusSummary();
  form.querySelector("[name=ordem_data]").value = "novas";
  for (const field of form.querySelectorAll("[data-date-field]")) {
    const button = field.querySelector("button");
    button.textContent = button.dataset.placeholder;
    button.classList.remove("filled");
  }
  syncSlider();
  schedule(0);
});
