import { config } from "./config.js";
import app from "./index.js";

// Só para rodar localmente (npm run dev). Na Vercel, o app vem do src/index.ts.
// 0.0.0.0: aceita conexões da rede local (abrir no celular pelo IP do PC).
app.listen(config.PORT, "0.0.0.0", () => {
  console.log(`mercado-wise ouvindo em http://localhost:${config.PORT}`);
});
