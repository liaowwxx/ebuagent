# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Build & Run

```bash
npm run build          # Copies QR codes into public/ and generates products.json from 商品.xlsx
npm start              # Starts Node.js dev server on http://localhost:4173
```

- `npm run build` runs two Python scripts: `build-data.py` (reads the spreadsheet + QR images → `public/data/products.json`) and `prepare-public.py` (copies `mini_qrcode_export/` → `public/mini_qrcode_export/`).
- `npm start` runs `server.js` as ESM (`"type": "module"` in package.json). No bundler, no framework.
- Cloudflare Pages local preview: `npx wrangler pages dev public`

There are **no tests**, no lint, no TypeScript, no build toolchain, and zero npm dependencies.

## Architecture

This is a conversational product recommendation agent for a WeChat Mini Program storefront. The user describes what they want in chat; the system responds with LLM-generated analysis text and product cards (name, price, reason, specs, QR code).

```
                     ┌──────────────┐
                     │   public/    │  Static site (vanilla HTML/CSS/JS)
                     │  index.html  │  Served directly by both Node.js and Cloudflare
                     │  app.js      │
                     │  styles.css  │
                     └──────┬───────┘
                            │ SSE stream (POST /api/recommend/stream)
                            │ Auth: POST /api/login, GET /api/check
          ┌─────────────────┴─────────────────┐
          │                                   │
   ┌──────┴──────┐                    ┌───────┴──────────┐
   │  server.js  │  (dev, Node.js)    │  functions/api/  │  (prod, Cloudflare Workers)
   │  port 4173   │                    │  recommend/stream│
   │  Node crypto │                    │  login.js        │
   └──────┬──────┘                    │  check.js        │
          │                            └───────┬──────────┘
          │                                    │
          └──────────┬─────────────────────────┘
                     │  Shared modules (ESM imports)
            ┌────────┴─────────┐
            │  src/            │
            │  recommendation-core.js  ← Main logic: LLM pipeline + local fallback
            │  auth.js                 ← HMAC-SHA256 tokens via Web Crypto API
            │  rate-limiter.js         ← In-memory fixed-window rate limiter
            └──────────────────────────┘
```

**Key architectural constraint:** `src/` modules must run in BOTH Node.js (`server.js`) and Cloudflare Workers (`functions/`). They use Web Crypto API (not Node's `crypto`) and no Node-specific or Worker-specific APIs.

### Recommendation Pipeline (`src/recommendation-core.js`)

Two-phase SSE stream:

1. **Phase 1 — Plan:** LLM selects up to 3 products from a candidate pool and generates reasons/angles. Calls OpenAI-compatible API with `response_format: json_object`. Falls back to `localCandidates()` (keyword matching, price intent parsing, category heuristics) when no `OPENAI_API_KEY` is configured.
2. **Phase 2 — Stream:** LLM generates explanatory text, streamed token-by-token as SSE `token` events. Falls back to `fallbackStreamText()` (hardcoded Chinese responses) when no API key.

Event types sent to the client: `meta`, `recommendations`, `token`, `error`, `done`.

### Product Data

Product catalog lives in `public/data/products.json` (55 products, generated from `商品.xlsx` + QR images). Each product has `productId`, `name`, `brand`, `category1/2/3`, `priceMin/Max`, `specs` array, `qrCodePath`, and a precomputed `searchText` field for keyword matching.

### Auth (optional)

Auth is activated by setting `AUTH_USERNAME` and `AUTH_PASSWORD` env vars. Token flow: `POST /api/login` → HMAC-signed cookie (7-day expiry) → checked by `GET /api/check` → required for `/api/recommend/stream`. Login is rate-limited to 5 attempts per 60s per IP.

### Frontend (`public/app.js`)

Vanilla JS, module script. Renders streaming markdown (basic support: headings, bold, code, lists). Product cards appear in the right panel. Responsive: grid on desktop, bottom-sheet drawer on mobile (≤760px). SSE parsed manually from `ReadableStream` via `response.body.getReader()`.

### Deployment

Cloudflare Pages with Functions. Config in `wrangler.toml`. Build output dir is `public/`. Functions use `onRequestPost({ request, env })` pattern.
