# Elite-Trade

A professional crypto trading platform with automated bot strategies, real-time market data, portfolio management, risk management, and a Telegram notification system.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (builds then starts, port from `$PORT`)
- `pnpm --filter @workspace/pro-crypto-bot run dev` — run the React dashboard (port from `$PORT`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/db run push-force` — force push schema (drops conflicting tables)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 (artifacts/api-server)
- Frontend: React 19 + Vite + Tailwind v4 (artifacts/pro-crypto-bot)
- DB: PostgreSQL + Drizzle ORM (lib/db)
- Queue: BullMQ + Redis (trade queue, worker)
- Validation: Zod (zod/v4), drizzle-zod
- Exchange: Gate.io via CCXT + Gate.io WebSocket
- Notifications: Telegram Bot API
- Auth: bcryptjs + JWT (SESSION_SECRET)
- Encryption: AES-256-CBC (ENCRYPTION_KEY) for stored API keys

## Where things live

- `artifacts/api-server/src/lib/bot.ts` — core trading engine (start/stop/config)
- `artifacts/api-server/src/lib/orchestrator.ts` — multi-strategy orchestration engine
- `artifacts/api-server/src/lib/advancedRiskEngine.ts` — risk management
- `artifacts/api-server/src/lib/riskManager.ts` — position risk controls
- `artifacts/api-server/src/lib/telegramNotifier.ts` — Telegram alerts
- `artifacts/api-server/src/lib/gateioWs.ts` — Gate.io WebSocket market feed
- `artifacts/api-server/src/services/strategies/` — strategy implementations
- `artifacts/api-server/src/queues/tradeQueue.ts` — BullMQ trade queue
- `artifacts/api-server/src/routes/routes/` — all API route handlers
- `artifacts/pro-crypto-bot/src/` — React dashboard (pages, hooks, components)
- `lib/db/src/schema/` — all database table definitions

## Architecture decisions

- JWT stored in `localStorage` as `pcb_jwt`; session timestamp under `pcb_session_ts` (30-min inactivity lock)
- First visit shows Register screen (`authState === "setup"`); register via `POST /api/auth/register`
- Live trading requires `ENCRYPTION_KEY` to be set; without it the server auto-enforces paper mode
- Redis is required for BullMQ trade queue; without `REDIS_URL`, queue features are disabled but the server still runs in paper mode
- Gate.io API credentials can be set via env (`GATEIO_API_KEY` / `GATEIO_API_SECRET`) or via the in-app UI

## Required Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | ✅ auto-set | PostgreSQL connection (Replit built-in) |
| `SESSION_SECRET` | ✅ set | JWT signing secret |
| `ENCRYPTION_KEY` | ❌ needed | AES-256 key for API key storage; enables live trading (generate: `openssl rand -base64 32`) |
| `REDIS_URL` | ❌ needed | Upstash/Redis URL for BullMQ trade queue |
| `TELEGRAM_BOT_TOKEN` | ❌ optional | Telegram bot for trade notifications |
| `GATEIO_API_KEY` | ❌ optional | Gate.io API key (can also set via UI) |
| `GATEIO_API_SECRET` | ❌ optional | Gate.io API secret (can also set via UI) |

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- CSS uses Tailwind v4 `@theme {}` direct hex tokens — do NOT replace with HSL placeholder scaffold
- The ZIP's 4 backend TS errors are already fixed in the restored files
- Build requires `PORT` and `BASE_PATH` injected by workflows; don't run `pnpm run build` bare from shell
- After any lib schema/code change, run `pnpm run typecheck:libs` before artifact typechecks
- `drizzle-zod` version must stay at `^0.8.3` — newer versions break `zod/v4` compatibility
