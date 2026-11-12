// Movimento do app inteiro:
// - <details> abre e fecha deslizando (o navegador só troca de uma vez);
// - barra de carregamento no topo e spinner no botão enquanto a próxima página
//   não chega (a troca de página em si é uma transição CSS, em app.css).
// Quem pediu menos movimento no sistema vê tudo instantâneo.
const still = matchMedia("(prefers-reduced-motion: reduce)");
const running = new WeakMap();

// Abre ou fecha um <details> animando a altura. Usado também pelo "Pronto" da revisão.
function animateOpen(details, open) {
  const current = running.get(details);
  if ((current ? current.open : details.open) === open) return;
  const start = details.offsetHeight;
  current?.anim.cancel();
  details.open = open;
  const end = details.offsetHeight;
  if (still.matches || start === end) {
    running.delete(details);
    details.style.overflow = "";
    return;
  }
  details.open = true;
  details.style.overflow = "hidden";
  const anim = details.animate(
    { height: [`${start}px`, `${end}px`] },
    { duration: 240, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
  );
  running.set(details, { open, anim });
  anim.onfinish = () => {
    running.delete(details);
    details.style.overflow = "";
    details.open = open;
  };
}
window.animateOpen = animateOpen;

document.addEventListener("click", (event) => {
  const summary = event.target.closest("summary");
  const details = summary?.parentElement;
  // Menus suspensos (avatar, filtros de status) não empurram a página: têm animação
  // própria no CSS.
  if (
    details?.localName !== "details" ||
    details.matches(".user-menu, .dropdown")
  )
    return;
  event.preventDefault();
  animateOpen(details, !(running.get(details)?.open ?? details.open));
});

// Carregando: a página atual continua na tela até a próxima chegar, então mostra
// que o toque foi recebido.
function loading(button) {
  document.documentElement.classList.add("loading");
  button?.setAttribute("aria-busy", "true");
}
document.addEventListener("click", (event) => {
  const link = event.target.closest("a[href]");
  if (
    !link ||
    event.defaultPrevented ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    link.target ||
    link.hasAttribute("download") ||
    link.origin !== location.origin ||
    (link.hash && link.pathname === location.pathname)
  )
    return;
  loading();
});
document.addEventListener("submit", (event) => {
  // upload.js e confirm() cancelam o envio normal; aí não há página nova vindo.
  if (!event.defaultPrevented) loading(event.submitter);
});
// Voltar pelo navegador restaura a página da memória: tira o estado de carregando.
addEventListener("pageshow", () => {
  document.documentElement.classList.remove("loading");
  for (const b of document.querySelectorAll("button[aria-busy]"))
    b.removeAttribute("aria-busy");
});

// O Safari do iPhone só aplica :active (o "afundar" do botão) com um ouvinte de toque.
document.addEventListener("touchstart", () => {}, { passive: true });
