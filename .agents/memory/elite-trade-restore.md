---
name: Elite-Trade restore notes
description: Critical facts about the Elite-Trade platform restoration from ZIP — what broke, what was pre-fixed, and what env vars are needed.
---

## CSS — Tailwind v4 @theme tokens

**Rule:** `artifacts/pro-crypto-bot/src/index.css` uses `@theme { --color-background: #090a0f; ... }` with direct hex colors. The react-vite scaffold generates `hsl(var(--background))` with `red` placeholder sentinels.

**Why:** Scaffold template overwrites this file on generation.

**How to apply:** The ZIP's CSS is already in place. If the scaffold ever regenerates this file, restore it from the ZIP or git history.

---

## Backend TS errors — pre-fixed in ZIP

Four type errors were present in the original ZIP source and fixed before archiving:

1. `multiSymbolScanner.ts` — `sig.stopLossPct ?? undefined` / `sig.takeProfitPct ?? undefined` (was `number | null`, needed `number | undefined`)
2. `manual-trading.ts` — called `bot.buildStatus()` (not `bot.getStatus()`)
3. `manual-trading.ts` — `{ action: "close", ...result }` (dropped `ok: true` to avoid TS2783 duplicate key)
4. `strategyService.ts` — `const price` moved above the `atr` validity check block

---

## Required environment variables

| Variable | Purpose | Notes |
|---|---|---|
| `DATABASE_URL` | PostgreSQL | Auto-set by Replit |
| `SESSION_SECRET` | JWT signing | Already set as workspace secret |
| `ENCRYPTION_KEY` | AES-256 for stored API keys | Required for live trading; `openssl rand -base64 32` |
| `REDIS_URL` | BullMQ trade queue | Upstash-compatible; without it queue disabled, paper mode only |
| `TELEGRAM_BOT_TOKEN` | Telegram notifications | Optional |
| `GATEIO_API_KEY` | Gate.io exchange | Optional — can also set via in-app UI |
| `GATEIO_API_SECRET` | Gate.io exchange | Optional — can also set via in-app UI |

---

## Auth flow

- JWT in `localStorage` as `pcb_jwt`; session timestamp `pcb_session_ts` (30-min inactivity lock)
- First visit → Register screen (`authState === "setup"`)
- Register: `POST /api/auth/register` with `{ username, password }`

---

## Live trading safety gate

Without `ENCRYPTION_KEY` OR without Redis: server enforces paper mode via `startupGuard`. Startup status is printed to server logs at boot.

---

## Production build

Requires `PORT` and `BASE_PATH` env vars. Run as:
```
PORT=3000 BASE_PATH=/ pnpm --filter @workspace/pro-crypto-bot run build
```
Workflow config injects these automatically in dev.
