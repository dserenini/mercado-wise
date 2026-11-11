// Mapa da página do mercado (MapLibre GL JS + mapa do OpenFreeMap, sem chave).
// Mostra a loja; arrastar o marcador ou clicar no mapa preenche latitude e
// longitude no formulário (vale ao Salvar). Digitar nos campos move o marcador.
// Sem coordenadas ainda, abre no Brasil inteiro e espera o primeiro clique.
import {
  Map as MapLibre,
  Marker,
  NavigationControl,
} from "https://cdn.jsdelivr.net/npm/maplibre-gl@6.15.0/dist/maplibre-gl.mjs";

const el = document.getElementById("store-map");
const form = el?.closest("form");
const latInput = form?.elements.namedItem("latitude");
const lngInput = form?.elements.namedItem("longitude");

if (el && latInput && lngInput) {
  const lat = Number.parseFloat(el.dataset.lat);
  const lng = Number.parseFloat(el.dataset.lng);
  const has = Number.isFinite(lat) && Number.isFinite(lng);

  const map = new MapLibre({
    container: el,
    style: "https://tiles.openfreemap.org/styles/liberty",
    center: has ? [lng, lat] : [-51.9, -14.2],
    zoom: has ? 16 : 3,
    cooperativeGestures: true, // no celular, um dedo rola a página, dois mexem no mapa
    locale: {
      "CooperativeGesturesHandler.WindowsHelpText":
        "Use Ctrl + rolagem para dar zoom no mapa",
      "CooperativeGesturesHandler.MacHelpText":
        "Use ⌘ + rolagem para dar zoom no mapa",
      "CooperativeGesturesHandler.MobileHelpText":
        "Use dois dedos para mover o mapa",
      "NavigationControl.ZoomIn": "Aproximar",
      "NavigationControl.ZoomOut": "Afastar",
      "NavigationControl.ResetBearing": "Apontar para o norte",
      "AttributionControl.ToggleAttribution": "Créditos do mapa",
      "AttributionControl.MapFeedback": "Corrigir o mapa",
      "Map.Title": "Mapa",
      "Marker.Title": "Posição do mercado",
    },
  });
  map.addControl(new NavigationControl({ showCompass: false }), "top-right");

  // Marcador próprio: pino na cor do app com um carrinho (o padrão do MapLibre
  // destoava). A ponta do pino fica na coordenada (anchor "bottom").
  const pin = () => {
    const el = document.createElement("div");
    el.className = "store-pin";
    el.innerHTML = `<span class="store-pin-head"><svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 4h2l2.4 10.2a1 1 0 0 0 1 .8h8.8a1 1 0 0 0 1-.8L20 8H6.2" />
      <circle cx="9.5" cy="19" r="1.5" /><circle cx="17" cy="19" r="1.5" /></svg></span>`;
    return el;
  };

  let marker = null;
  const fill = ({ lng, lat }) => {
    latInput.value = lat.toFixed(7);
    lngInput.value = lng.toFixed(7);
  };
  const place = (lngLat) => {
    if (!marker) {
      marker = new Marker({ element: pin(), anchor: "bottom", draggable: true })
        .setLngLat(lngLat)
        .addTo(map);
      marker
        .getElement()
        .setAttribute(
          "aria-label",
          "Posição do mercado (arraste para ajustar)",
        );
      marker.on("dragend", () => fill(marker.getLngLat()));
    } else marker.setLngLat(lngLat);
  };

  if (has) place([lng, lat]);
  map.on("click", (event) => {
    place(event.lngLat);
    fill(event.lngLat);
  });

  // Coordenada digitada à mão: leva o marcador (e o mapa) até ela.
  const fromInputs = () => {
    const la = Number.parseFloat(latInput.value.replace(",", "."));
    const lo = Number.parseFloat(lngInput.value.replace(",", "."));
    if (Math.abs(la) <= 90 && Math.abs(lo) <= 180) {
      place([lo, la]);
      map.easeTo({ center: [lo, la], zoom: Math.max(map.getZoom(), 15) });
    }
  };
  latInput.addEventListener("change", fromInputs);
  lngInput.addEventListener("change", fromInputs);
}
