import { createApp } from "./app.js";
import { config } from "./config.js";

createApp().listen(config.PORT, () => {
  console.log(`mercado-wise ouvindo em http://localhost:${config.PORT}`);
});
