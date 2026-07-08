# Mercado Fácil

App mobile-first (PWA) para registrar compras de supermercado a partir do **QR Code da NFC-e**
(nota fiscal), acompanhar histórico e ver insights de gastos. Foco atual: **Minas Gerais (Sefaz MG)**.

## Arquitetura

```
┌─────────────┐   JWT (chave pública)   ┌──────────────────┐
│  PWA React  │ ──────────────────────▶ │ Supabase         │  dados do usuário (via RLS)
│ (Vite + TS) │                         │ Postgres + Auth  │
└─────┬───────┘                         └──────────────────┘
      │ POST /upload-cupom (Bearer JWT)          ▲
      ▼                                          │ escreve sob RLS (JWT do usuário)
┌──────────────────────────────┐                 │
│ FastAPI (OCR/scrape/normalize)│─────────────────┘
│  • valida o JWT no Supabase   │
│  • lê QR (pyzbar/OpenCV)      │──▶ Sefaz MG (allowlist de domínio, anti-SSRF)
│  • normaliza nomes (Gemini)   │──▶ Google Gemini
└──────────────────────────────┘
```

**Princípio de segurança:** o backend nunca escreve "em nome do" usuário com a `service_role`.
Ele valida o JWT e grava usando a chave pública + o token do usuário, de modo que a **RLS**
continua valendo. A `service_role` só toca tabelas globais (`product_dictionary`, `supermarket_aliases`).

## Stack

- **Frontend:** Vite, React, TypeScript, Tailwind, shadcn/ui, react-query, react-router. PWA via `vite-plugin-pwa`.
- **Backend:** FastAPI (pacote `backend/app/`), pyzbar/OpenCV (QR), BeautifulSoup (scraping), `google-genai` (normalização), slowapi (rate limit).
- **Dados/Auth:** Supabase (Postgres + RLS + Auth).

## Setup local

Pré-requisitos: Node 20+, Python 3.11+, e as libs de sistema do OpenCV/zbar (`libzbar0`, `libgl1`).

1. Copie as variáveis de ambiente e preencha:
   ```sh
   cp .env.example .env
   ```
2. **Frontend:**
   ```sh
   npm ci
   npm run dev        # http://localhost:8080
   ```
3. **Backend:**
   ```sh
   cd backend
   python -m venv venv && . venv/Scripts/activate   # (Windows: venv\Scripts\activate)
   pip install -r requirements.txt
   uvicorn app.main:app --reload   # http://localhost:8000
   ```

### Variáveis de ambiente

Veja [.env.example](.env.example). Resumo:

| Variável | Escopo | Descrição |
|---|---|---|
| `VITE_SUPABASE_URL` | público | URL do projeto Supabase |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | público | Chave pública (anon) |
| `VITE_API_URL` | público | URL do backend FastAPI |
| `SUPABASE_SERVICE_ROLE_KEY` | **segredo** | Chave mestra — só tabelas globais |
| `GEMINI_API_KEY` | **segredo** | API do Gemini |
| `ALLOWED_ORIGINS` | backend | Origens do CORS (vírgula) |
| `ALLOWED_SEFAZ_DOMAINS` | backend | Domínios Sefaz aceitos (anti-SSRF) |
| `MAX_UPLOAD_MB` | backend | Limite de upload |

> Segredos (`SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`) **nunca** vão para o bundle do frontend.

## Testes

```sh
cd backend && pytest        # testes do parser/scraper/allowlist
npm run typecheck && npm run build   # frontend
```

## Deploy (Docker)

```sh
docker compose up --build
# web  → http://localhost:8080
# api  → http://localhost:8000
```

O `docker-compose.yml` injeta apenas as variáveis **públicas** `VITE_*` como build-args do
frontend; os segredos vão só para o container da API via `env_file`.
