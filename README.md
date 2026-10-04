# mercado-wise

Foto da nota fiscal → leitura → interpretação → banco. Node + TypeScript.

No ar em **https://mercado-wise.vercel.app**. O app antigo (Python + React) está
na tag `legacy-v0`.

## Como funciona

1. **Ler** ([src/services/reader.ts](src/services/reader.ts)): o Claude transcreve a
   foto literalmente (descrição crua, EAN, quantidades, preços, cabeçalho).
2. **Validar** ([src/services/validators.ts](src/services/validators.ts)): sem IA —
   dígitos verificadores e contas da própria nota → semáforo.
3. **Interpretar** ([src/services/interpreter.ts](src/services/interpreter.ts)): a
   descrição crua vira produto, marca, variante, embalagem e categoria. Consulta
   antes a **memória** de itens confirmados ([src/db/memory.ts](src/db/memory.ts)).
4. **Revisar e confirmar** (web): nada vira dado definitivo sem a revisão. A
   confirmação ensina a memória.

[src/services/ingest.ts](src/services/ingest.ts) junta tudo: foto → rascunho no banco
(com checagem de nota duplicada antes de gastar a interpretação).

Banco: Postgres do Supabase, schema `app` ([migrations/](migrations/)), acessado só
pelo servidor ([src/db/](src/db/)). Testes usam PGlite (Postgres em memória).

## Configuração

Copie `.env.example` para `.env` e preencha:

- `ANTHROPIC_API_KEY`: chave criada dentro de um workspace em platform.claude.com;
- `DATABASE_URL`: Supabase → botão **Connect** → *Transaction pooler* (porta 6543);
- `APP_PASSWORD_HASH` e `SESSION_SECRET`: gerados por `npm run setup-login`.

Depois: `npm run migrate`.

## Comandos

```bash
npm install
npm run dev        # app em http://localhost:3000 (recarrega ao salvar)
npm test           # Vitest
npm run typecheck  # tsc --noEmit
npm run lint       # Biome (npm run format corrige)

npm run setup-login                          # senha do app → linhas para o .env
npm run migrate                              # aplica migrations no banco
npm run ingest -- foto.jpg                   # foto → rascunho no banco (usa a API)
npm run process -- foto.jpg                  # pipeline sem gravar (usa a API)
npm run read -- foto.jpg > nota.read.json    # só a leitura (usa a API)
npm run validate -- nota.read.json           # confere leituras salvas (sem API)
npm run interpret -- nota.read.json          # interpreta leituras salvas (usa a API)
npm run import-saved -- pasta/               # leituras salvas → rascunhos (sem API)
npm run seed-memory -- gabarito.json         # gabarito revisado → memória (sem API)
npm run report -- --dolar 5,40               # critérios da Fase 8: IA × revisão (sem API)
```

Fotos de notas reais ficam em `eval/fixtures/`, resultados em `eval/out/` e o
gabarito em `eval/ground-truth/` — tudo fora do git.

## Deploy

Vercel, integrada ao GitHub: cada push na `main` publica em produção; outras
branches geram um deploy de preview.

- Entrada: [src/index.ts](src/index.ts) (a Vercel exige que ele importe o `express`).
- Estáticos: `public/` (servidos pela CDN; `express.static` só vale localmente).
- [vercel.json](vercel.json): região `gru1` (São Paulo, junto do Supabase) e as telas
  EJS incluídas na função.
- Variáveis no painel da Vercel: `ANTHROPIC_API_KEY`, `DATABASE_URL`,
  `APP_PASSWORD_HASH`, `SESSION_SECRET`.
- Migrations rodam à mão (`npm run migrate`), antes do push que depende delas.
- TypeScript fica na 6.x: o builder da Vercel não transpila com o TypeScript 7.
