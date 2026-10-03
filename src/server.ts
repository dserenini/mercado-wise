import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 3000);

createApp().listen(port, () => {
  console.log(`mercado-wise ouvindo em http://localhost:${port}`);
});
