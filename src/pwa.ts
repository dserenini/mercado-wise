import { registerSW } from "virtual:pwa-register";

// A cada quanto tempo procurar por uma nova versão enquanto o app está aberto.
const UPDATE_INTERVAL_MS = 60 * 60 * 1000; // 1h

/**
 * Registra o service worker do PWA.
 *
 * Com `registerType: "autoUpdate"` (vite.config.ts), o módulo virtual já recarrega
 * a página automaticamente assim que um novo service worker assume o controle
 * (o sw.js chama skipWaiting + clientsClaim). Aqui só garantimos que a checagem
 * de novas versões aconteça de forma agressiva — periodicamente e, principalmente,
 * toda vez que o usuário reabre o app pelo atalho da tela inicial (visibilitychange),
 * que é justamente o caso em que a versão antiga ficava "presa" em cache.
 */
export function registerPwa() {
  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;

      const checkForUpdate = () => {
        registration.update().catch(() => {
          /* offline ou falha de rede — tentaremos de novo depois */
        });
      };

      setInterval(checkForUpdate, UPDATE_INTERVAL_MS);

      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") checkForUpdate();
      });
    },
  });
}
