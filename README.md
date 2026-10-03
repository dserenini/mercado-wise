# mercado-wise

Foto da nota fiscal → leitura → interpretação → banco. Node + TypeScript.

Reconstrução em andamento na branch `rebuild`. O app antigo (Python + React)
está na tag `legacy-v0`.

## Comandos

```bash
npm install
npm run dev        # servidor em http://localhost:3000 (recarrega ao salvar)
npm test           # Vitest
npm run typecheck  # tsc --noEmit
npm run lint       # Biome (npm run format corrige)
```

`GET /health` → `{"status":"ok"}`.
