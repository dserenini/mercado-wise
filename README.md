# mercado-wise

Foto da nota fiscal → leitura → interpretação → banco. Node + TypeScript.

Reconstrução em andamento na branch `rebuild`. O app antigo (Python + React)
está na tag `legacy-v0`.

## Como funciona

1. **Ler** ([src/services/reader.ts](src/services/reader.ts)): o Claude transcreve a
   foto literalmente (descrição crua, EAN, quantidades, preços, cabeçalho).
2. **Validar** ([src/services/validators.ts](src/services/validators.ts)): sem IA —
   dígitos verificadores e contas da própria nota → semáforo.
3. **Interpretar** ([src/services/interpreter.ts](src/services/interpreter.ts)): a
   descrição crua vira produto, marca, variante, embalagem e categoria. Consulta a
   memória de itens confirmados antes de chamar a IA.

[src/services/pipeline.ts](src/services/pipeline.ts) junta as três etapas.

## Configuração

Copie `.env.example` para `.env` e preencha `ANTHROPIC_API_KEY` (chave criada
dentro de um workspace em platform.claude.com).

## Comandos

```bash
npm install
npm run dev        # servidor em http://localhost:3000 (recarrega ao salvar)
npm test           # Vitest
npm run typecheck  # tsc --noEmit
npm run lint       # Biome (npm run format corrige)

npm run process -- foto.jpg                  # pipeline completo (usa a API)
npm run read -- foto.jpg > nota.read.json    # só a leitura (usa a API)
npm run validate -- nota.read.json           # confere leituras salvas (sem API)
npm run interpret -- nota.read.json          # interpreta leituras salvas (usa a API)
```

Fotos de notas reais ficam em `eval/fixtures/` e resultados em `eval/out/`, ambos
fora do git.
