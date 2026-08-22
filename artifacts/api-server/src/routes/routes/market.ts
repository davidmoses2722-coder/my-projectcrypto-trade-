/**
 * /api/market — Gate.io public data proxy
 *
 * Browser → /api/market/tickers → (server) → https://api.gateio.ws/api/v4/spot/tickers
 *
 * Reason: Gate.io REST rejects http://localhost CORS preflight in dev.
 * The WS stream (no CORS) is the primary source; this REST endpoint is
 * the fallback when the WS is reconnecting.
 */
import { Router } from "express";
import https from "https";
import { logger } from "../../lib/logger";

const router = Router();

const GATE_TICKERS = "https://api.gateio.ws/api/v4/spot/tickers";

/** GET /api/market/tickers — proxies Gate.io spot tickers, no auth required */
router.get("/market/tickers", (_req, res) => {
  https.get(GATE_TICKERS, { headers: { Accept: "application/json" } }, (upstream) => {
    const chunks: Buffer[] = [];

    upstream.on("data", (chunk: Buffer) => chunks.push(chunk));

    upstream.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      res
        .status(upstream.statusCode ?? 200)
        .setHeader("Content-Type", "application/json")
        .send(body);
    });

    upstream.on("error", (err) => {
      logger.warn({ err }, "market proxy upstream error");
      res.status(502).json({ error: "upstream fetch failed" });
    });
  }).on("error", (err) => {
    logger.warn({ err }, "market proxy connect error");
    res.status(502).json({ error: "Gate.io unreachable" });
  });
});

/** GET /api/market/candles?symbol=BTC_USDT&interval=1h&limit=120 — Gate.io candle proxy */
router.get("/market/candles", (req, res) => {
  const symbol = String(req.query.symbol ?? "BTC_USDT").toUpperCase().replace("/", "_");
  const interval = String(req.query.interval ?? "1h");
  const limit = Math.min(500, Math.max(20, Number(req.query.limit ?? 120)));
  if (!/^[A-Z0-9]+_[A-Z0-9]+$/.test(symbol)) {
    res.status(400).json({ ok: false, error: "Invalid Gate.io symbol" }); return;
  }
  const url = new URL("https://api.gateio.ws/api/v4/spot/candlesticks");
  url.searchParams.set("currency_pair", symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("limit", String(limit));
  https.get(url, { headers: { Accept: "application/json" } }, (upstream) => {
    const chunks: Buffer[] = [];
    upstream.on("data", (chunk: Buffer) => chunks.push(chunk));
    upstream.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      if ((upstream.statusCode ?? 500) >= 400) {
        res.status(upstream.statusCode ?? 502).json({ ok: false, error: "Gate.io candle request failed" }); return;
      }
      try {
        const rows = JSON.parse(body) as string[][];
        // Gate.io returns candles oldest-first (ascending) — keep that order;
        // lightweight-charts requires strictly ascending timestamps.
        const candles = rows
          .map((r) => ({
            time:   Number(r[0]) * 1000,
            volume: Number(r[1]),
            close:  Number(r[2]),
            high:   Number(r[3]),
            low:    Number(r[4]),
            open:   Number(r[5]),
          }))
          .filter((c) =>
            isFinite(c.time) && isFinite(c.open) &&
            isFinite(c.high) && isFinite(c.low) && isFinite(c.close),
          )
          .sort((a, b) => a.time - b.time); // guarantee ascending
        res.json({ ok: true, symbol, interval, candles });
      } catch {
        res.status(502).json({ ok: false, error: "Invalid candle response" });
      }
    });
    upstream.on("error", () => res.status(502).json({ ok: false, error: "Gate.io candle stream failed" }));
  }).on("error", () => res.status(502).json({ ok: false, error: "Gate.io unreachable" }));
});

/** GET /api/market/orderbook?symbol=BTC_USDT&limit=20 — live Gate.io depth proxy */
router.get("/market/orderbook", (req, res) => {
  const symbol = String(req.query.symbol ?? "BTC_USDT").toUpperCase().replace("/", "_");
  const limit = Math.min(100, Math.max(5, Number(req.query.limit ?? 20)));
  const url = new URL("https://api.gateio.ws/api/v4/spot/order_book");
  url.searchParams.set("currency_pair", symbol);
  url.searchParams.set("limit", String(limit));
  https.get(url, { headers: { Accept: "application/json" } }, (upstream) => {
    const chunks: Buffer[] = [];
    upstream.on("data", (chunk: Buffer) => chunks.push(chunk));
    upstream.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      if ((upstream.statusCode ?? 500) >= 400) { res.status(upstream.statusCode ?? 502).json({ ok:false,error:"Gate.io orderbook request failed" }); return; }
      try {
        const d = JSON.parse(body);
        res.json({ ok:true, symbol, asks:d.asks??[], bids:d.bids??[], updateId:d.id??null, timestamp:Date.now() });
      } catch { res.status(502).json({ok:false,error:"Invalid orderbook response"}); }
    });
    upstream.on("error",()=>res.status(502).json({ok:false,error:"Gate.io orderbook stream failed"}));
  }).on("error",()=>res.status(502).json({ok:false,error:"Gate.io unreachable"}));
});

/** GET /api/market/trades?symbol=BTC_USDT&limit=40 — recent public trades proxy */
router.get("/market/trades", (req, res) => {
  const symbol = String(req.query.symbol ?? "BTC_USDT").toUpperCase().replace("/", "_");
  const limit = Math.min(100, Math.max(5, Number(req.query.limit ?? 40)));
  const url = new URL("https://api.gateio.ws/api/v4/spot/trades");
  url.searchParams.set("currency_pair", symbol);
  url.searchParams.set("limit", String(limit));
  https.get(url, { headers: { Accept: "application/json" } }, (upstream) => {
    const chunks: Buffer[] = [];
    upstream.on("data", (chunk: Buffer) => chunks.push(chunk));
    upstream.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      if ((upstream.statusCode ?? 500) >= 400) { res.status(upstream.statusCode ?? 502).json({ ok:false,error:"Gate.io trades request failed" }); return; }
      try {
        const rows = JSON.parse(body) as Array<{ id: string; create_time: string; side: string; price: string; amount: string }>;
        const trades = rows.map(r => ({
          id: r.id, time: Number(r.create_time) * 1000, side: r.side, price: Number(r.price), qty: Number(r.amount),
        }));
        res.json({ ok: true, symbol, trades });
      } catch { res.status(502).json({ok:false,error:"Invalid trades response"}); }
    });
    upstream.on("error",()=>res.status(502).json({ok:false,error:"Gate.io trades stream failed"}));
  }).on("error",()=>res.status(502).json({ok:false,error:"Gate.io unreachable"}));
});

export default router;
