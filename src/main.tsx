import { createRoot } from "react-dom/client";
// Fontes auto-hospedadas (antes vinham do Google Fonts via @import, bloqueado pela CSP).
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/plus-jakarta-sans/500.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/plus-jakarta-sans/700.css";
import "@fontsource/plus-jakarta-sans/800.css";
import App from "./App.tsx";
import "./index.css";
import { registerPwa } from "./pwa";

createRoot(document.getElementById("root")!).render(<App />);

// Registra o service worker e mantém o app sempre na versão mais recente.
registerPwa();
