/**
 * futures.ts — Perp Futures trading endpoints.
 *
 * Isolated from the spot manual-trading path on purpose: this file does not
 * import lib/bot.ts's execution functions and does not touch the spot risk
 * engine, execution queue, or portfolio registry.
 */
import { Router, type Request, type Response } from "express";
import * as bot from "../../lib/bot";
import * as futuresExchange from "../../services/gateioFuturesExchange";
import * as exchangeService from "../../services/exchangeService";
import { publishEvent } from "../../lib/eventBus";
import { logger } from "../../lib/logger";
import { db, ordersTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const router = Router();

function creds() {
  const c = bot.getBotExchangeCreds();
  return { apiKey: c.apiKey, secret: c.secret, password: c.password, paper: c.paper };
}

function isPaperMode(): boolean {
  const c = bot.getBotExchangeCreds();
  return Boolean(c.paper);
}

// ─── GET /api/futures/capability ───────────────────────────────────────────

router.get("/futures/capability", async (_req: Request, res: Response): Promise<void> => {
  try {
    if (!bot.getBotHasKeys()) {
      res.json({ ok: true, supported: false, reason: "No Gate.io API keys connected." });
      return;
    }
    const result = await futuresExchange.checkFuturesCapability(creds());
    res.json({ ok: true, ...result });
  } catch (e) {
    logger.error({ err: e }, "futures.capability failed");
    res.json({ ok: true, supported: false, reason: e instanceof Error ? e.message : String(e) });
  }
});

// ─── GET /api/futures/account ─────────────────────────────────────────────

router.get("/futures/account", async (_req: Request, res: Response): Promise<void> => {
  try {
    if (isPaperMode()) {
      res.json({ ok: true, paper: true, ...futuresExchange.paperGetAccount() });
      return;
    }
    if (!bot.getBotHasKeys()) {
      res.json({ ok: true, paper: false, totalEquity: 0, availableBalance: 0, usedMargin: 0, unrealizedPnl: 0 });
      return;
    }
    const account = await futuresExchange.fetchAccount(creds());
    res.json({ ok: true, paper: false, ...account });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── GET /api/futures/ticker/:symbol ──────────────────────────────────────

router.get("/futures/ticker/:symbol", async (req: Request, res: Response): Promise<void> => {
  const symbol = String(req.params["symbol"] ?? "").toUpperCase();
  if (!symbol) { res.status(400).json({ ok: false, error: "symbol is required" }); return; }
  try {
    const ticker = await futuresExchange.fetchTickerPublic(symbol);
    if (!ticker) { res.status(502).json({ ok: false, error: "Could not fetch ticker" }); return; }
    res.json({ ok: true, ...ticker });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── GET /api/futures/orderbook/:symbol ───────────────────────────────────

router.get("/futures/orderbook/:symbol", async (req: Request, res: Response): Promise<void> => {
  const symbol = String(req.params["symbol"] ?? "").toUpperCase();
  const limit = Math.min(Number(req.query["limit"] ?? 20), 50);
  if (!symbol) { res.status(400).json({ ok: false, error: "symbol is required" }); return; }
  try {
    const ob = await futuresExchange.fetchOrderBookPublic(symbol, limit);
    if (!ob) { res.status(502).json({ ok: false, error: "Could not fetch order book" }); return; }
    res.json({ ok: true, ...ob });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── GET /api/futures/trades/:symbol ──────────────────────────────────────

router.get("/futures/trades/:symbol", async (req: Request, res: Response): Promise<void> => {
  const symbol = String(req.params["symbol"] ?? "").toUpperCase();
  const limit = Math.min(Number(req.query["limit"] ?? 50), 100);
  if (!symbol) { res.status(400).json({ ok: false, error: "symbol is required" }); return; }
  try {
    const trades = await futuresExchange.fetchRecentTradesPublic(symbol, limit);
    res.json({ ok: true, trades });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── GET /api/futures/positions ────────────────────────────────────────────

router.get("/futures/positions", async (_req: Request, res: Response): Promise<void> => {
  try {
    if (isPaperMode()) {
      res.json({ ok: true, paper: true, positions: futuresExchange.paperGetPositions() });
      return;
    }
    if (!bot.getBotHasKeys()) { res.json({ ok: true, positions: [] }); return; }
    const positions = await futuresExchange.fetchPositions(creds());
    res.json({ ok: true, paper: false, positions });
  } catch (e) {
    res.status(502).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── GET /api/futures/funding-rate/:symbol ─────────────────────────────────

router.get("/futures/funding-rate/:symbol", async (req: Request, res: Response): Promise<void> => {
  const symbol = String(req.params["symbol"] ?? "").toUpperCase();
  if (!symbol) { res.status(400).json({ ok: false, error: "symbol is required" }); return; }
  const result = await futuresExchange.fetchFundingRate(symbol);
  if (!result) { res.status(502).json({ ok: false, error: "Could not fetch funding rate" }); return; }
  res.json({ ok: true, ...result });
});

// ─── GET /api/futures/orders ────────────────────────────────────────────────

router.get("/futures/orders", async (req: Request, res: Response): Promise<void> => {
  try {
    if (isPaperMode()) {
      res.json({ ok: true, paper: true, orders: futuresExchange.paperGetOrders() });
      return;
    }
    const userId = req.user?.uid;
    if (!userId) { res.json({ ok: true, orders: [] }); return; }
    const rows = await db
      .select()
      .from(ordersTable)
      .where(and(eq(ordersTable.market, "futures"), eq(ordersTable.userId, userId)))
      .orderBy(desc(ordersTable.createdAt))
      .limit(100);
    res.json({ ok: true, orders: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── POST /api/futures/leverage ────────────────────────────────────────────

router.post("/futures/leverage", async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body ?? {};
    const symbol = String(body.symbol ?? "").toUpperCase();
    const leverage = Number(body.leverage);
    const marginMode = body.marginMode === "cross" ? "cross" : "isolated";

    if (!symbol) { res.status(400).json({ ok: false, error: "symbol is required" }); return; }
    if (!Number.isFinite(leverage) || leverage < 1 || leverage > 125) {
      res.status(400).json({ ok: false, error: "leverage must be between 1 and 125" }); return;
    }

    if (isPaperMode()) {
      const r = futuresExchange.paperSetLeverage(symbol, leverage, marginMode);
      if (!r.success) { res.status(400).json({ ok: false, error: r.error }); return; }
      res.json({ ok: true, symbol, leverage, marginMode });
      return;
    }

    if (!bot.getBotHasKeys()) { res.status(400).json({ ok: false, error: "No Gate.io API keys connected." }); return; }

    const cap = await futuresExchange.checkFuturesCapability(creds());
    if (!cap.supported) { res.status(400).json({ ok: false, error: cap.reason ?? "Futures not supported." }); return; }

    const result = await futuresExchange.setLeverage(creds(), symbol, leverage, marginMode);
    if (!result.success) { res.status(400).json({ ok: false, error: result.error }); return; }
    res.json({ ok: true, symbol, leverage, marginMode });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── POST /api/futures/order ───────────────────────────────────────────────

router.post("/futures/order", async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body ?? {};
    const symbol = String(body.symbol ?? "").trim().toUpperCase();
    const positionSide = body.positionSide === "short" ? "short" : "long";
    const orderType = String(body.orderType ?? "MARKET").toUpperCase();
    const limitPrice = body.limitPrice != null ? Number(body.limitPrice) : undefined;
    const quantity = Number(body.quantity);
    const leverage = Number(body.leverage ?? 1);
    const marginMode = body.marginMode === "cross" ? "cross" : "isolated";
    const tpPrice = body.tpPrice != null ? Number(body.tpPrice) : undefined;
    const slPrice = body.slPrice != null ? Number(body.slPrice) : undefined;

    if (!symbol || !/^[A-Z0-9_/:-]+$/.test(symbol)) {
      res.status(400).json({ ok: false, error: "A valid trading symbol is required" }); return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      res.status(400).json({ ok: false, error: "quantity must be > 0" }); return;
    }
    if (orderType === "LIMIT" && (!limitPrice || limitPrice <= 0)) {
      res.status(400).json({ ok: false, error: "limitPrice is required for LIMIT orders" }); return;
    }
    if (!Number.isFinite(leverage) || leverage < 1 || leverage > 125) {
      res.status(400).json({ ok: false, error: "leverage must be between 1 and 125" }); return;
    }

    const side = positionSide === "long" ? "buy" : "sell";

    // ── Paper mode ──────────────────────────────────────────────────────────
    if (isPaperMode()) {
      // Get current price from the exchange service
      let lastPrice = limitPrice ?? 0;
      try {
        const ticker = await exchangeService.getTicker(symbol);
        if (ticker) lastPrice = ticker.last;
      } catch { /* use fallback */ }
      if (orderType === "MARKET" && lastPrice <= 0) {
        res.status(400).json({ ok: false, error: "Cannot determine current price for paper market order" }); return;
      }

      const result = await futuresExchange.paperCreateOrder({
        symbol, side, type: orderType === "LIMIT" ? "limit" : "market",
        amount: quantity, price: limitPrice, leverage, marginMode,
        reduceOnly: false, tpPrice, slPrice,
      }, lastPrice);

      if (!result.success) { res.status(400).json({ ok: false, error: result.error }); return; }

      const orderId = randomUUID();
      try {
        await db.insert(ordersTable).values({
          orderId, userId: req.user?.uid ?? null, symbol,
          side: side === "buy" ? "BUY" : "SELL",
          orderType: orderType === "LIMIT" ? "LIMIT" : "MARKET",
          limitPrice: limitPrice != null ? String(limitPrice) : null,
          quantity: String(quantity), remainingQuantity: String(quantity),
          status: orderType === "LIMIT" ? "open" : "filled",
          source: "MANUAL", exchange: "paper", isPaper: true,
          market: "futures", positionSide, leverage, marginMode,
          filledAt: orderType === "LIMIT" ? null : new Date(),
        });
      } catch (dbErr) {
        logger.error({ err: dbErr, orderId }, "futures.order: DB write failed");
      }

      publishEvent({ type: "order:created", payload: { action: "futures_order_placed", symbol, positionSide, orderId }, ts: new Date().toISOString() });
      res.json({ ok: true, paper: true, action: "futures_order", symbol, positionSide, leverage, marginMode, ...result });
      return;
    }

    // ── Live mode ───────────────────────────────────────────────────────────
    if (!bot.getBotHasKeys()) {
      res.status(400).json({ ok: false, error: "No Gate.io API keys connected." }); return;
    }
    const cap = await futuresExchange.checkFuturesCapability(creds());
    if (!cap.supported) {
      res.status(400).json({ ok: false, error: cap.reason ?? "This Gate.io key does not have futures trading enabled." }); return;
    }

    const result = await futuresExchange.createOrder(creds(), {
      symbol, side, type: orderType === "LIMIT" ? "limit" : "market",
      amount: quantity, price: limitPrice, leverage, marginMode, tpPrice, slPrice,
    });

    if (!result.success) { res.status(400).json({ ok: false, error: result.error }); return; }

    const userId = req.user?.uid ?? null;
    const orderId = randomUUID();
    try {
      await db.insert(ordersTable).values({
        orderId, userId, symbol,
        side: side === "buy" ? "BUY" : "SELL",
        orderType: orderType === "LIMIT" ? "LIMIT" : "MARKET",
        limitPrice: limitPrice != null ? String(limitPrice) : null,
        quantity: String(quantity), remainingQuantity: String(quantity),
        status: orderType === "LIMIT" ? "open" : "filled",
        source: "MANUAL", exchange: "gateio",
        exchangeOrderId: result.orderId, isPaper: Boolean(creds().paper),
        market: "futures", positionSide, leverage, marginMode,
        filledAt: orderType === "LIMIT" ? null : new Date(),
      });
    } catch (dbErr) {
      logger.error({ err: dbErr, orderId }, "futures.order: DB write failed after exchange success");
    }

    publishEvent({ type: "order:created", payload: { action: "futures_order_placed", symbol, positionSide, orderId }, ts: new Date().toISOString() });
    res.json({ ok: true, paper: false, action: "futures_order", symbol, positionSide, leverage, marginMode, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── POST /api/futures/close ───────────────────────────────────────────────

router.post("/futures/close", async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body ?? {};
    const symbol = String(body.symbol ?? "").trim().toUpperCase();
    const positionSide = body.positionSide === "short" ? "short" : "long";
    const amount = Number(body.amount);

    if (!symbol) { res.status(400).json({ ok: false, error: "symbol is required" }); return; }
    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ ok: false, error: "amount must be > 0" }); return;
    }

    if (isPaperMode()) {
      let lastPrice = 0;
      try {
        const ticker = await exchangeService.getTicker(symbol);
        if (ticker) lastPrice = ticker.last;
      } catch { /* use 0 */ }
      if (lastPrice <= 0) {
        res.status(400).json({ ok: false, error: "Cannot determine current price" }); return;
      }
      const result = futuresExchange.paperClosePosition(symbol, positionSide, amount, lastPrice);
      if (!result.success) { res.status(400).json({ ok: false, error: result.error }); return; }
      publishEvent({ type: "position:update", payload: { action: "futures_manual_close", symbol, positionSide }, ts: new Date().toISOString() });
      res.json({ ok: true, paper: true, action: "futures_close", symbol, positionSide, ...result });
      return;
    }

    if (!bot.getBotHasKeys()) { res.status(400).json({ ok: false, error: "No Gate.io API keys connected." }); return; }
    const result = await futuresExchange.closePosition(creds(), symbol, positionSide, amount);
    if (!result.success) { res.status(400).json({ ok: false, error: result.error }); return; }
    publishEvent({ type: "position:update", payload: { action: "futures_manual_close", symbol, positionSide }, ts: new Date().toISOString() });
    res.json({ ok: true, paper: false, action: "futures_close", symbol, positionSide, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── POST /api/futures/cancel ─────────────────────────────────────────────

router.post("/futures/cancel", async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body ?? {};
    const symbol = String(body.symbol ?? "").trim().toUpperCase();
    const orderId = String(body.orderId ?? "");

    if (!symbol || !orderId) { res.status(400).json({ ok: false, error: "symbol and orderId are required" }); return; }

    if (isPaperMode()) {
      res.json({ ok: true, paper: true, message: "Paper order cancelled" });
      return;
    }

    if (!bot.getBotHasKeys()) { res.status(400).json({ ok: false, error: "No Gate.io API keys connected." }); return; }
    const result = await futuresExchange.cancelOrder(creds(), symbol, orderId);
    if (!result.success) { res.status(400).json({ ok: false, error: result.error }); return; }
    res.json({ ok: true, paper: false, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── GET /api/futures/candles/:symbol ──────────────────────────────────────

router.get("/futures/candles/:symbol", async (req: Request, res: Response): Promise<void> => {
  try {
    const rawSym = String(req.params.symbol ?? "").trim().toUpperCase();
    const interval = String(req.query.interval ?? "1h");
    const limit = Math.min(500, Math.max(20, Number(req.query.limit ?? 120)));

    // Normalize to Gate.io futures contract format: BTC/USDT → BTC_USDT or BTCUSDT → BTC_USDT
    let contract = rawSym.replace(/[\/]/g, "_");
    if (!contract.includes("_")) contract = contract.replace(/(USDT|USD)$/i, "_$&");
    contract = contract.toUpperCase();

    const https = await import("node:https");
    const url = new URL("https://api.gateio.ws/api/v4/futures/usdt/candlesticks");
    url.searchParams.set("contract", contract);
    url.searchParams.set("interval", interval);
    url.searchParams.set("limit", String(limit));

    https.default.get(url, { headers: { Accept: "application/json" } }, (upstream) => {
      const chunks: Buffer[] = [];
      upstream.on("data", (chunk: Buffer) => chunks.push(chunk));
      upstream.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if ((upstream.statusCode ?? 500) >= 400) {
          res.status(upstream.statusCode ?? 502).json({ ok: false, error: "Gate.io futures candle request failed" }); return;
        }
        try {
          const rows = JSON.parse(body) as Array<Record<string, unknown>>;
          // Gate.io futures candle format: {t, o, h, l, c, v} or [{t, o, h, l, c, v}]
          const candles = rows
            .map((r) => ({
              time:   Number(r.t ?? r[0]) * 1000,
              open:   Number(r.o ?? r[1]),
              high:   Number(r.h ?? r[2]),
              low:    Number(r.l ?? r[3]),
              close:  Number(r.c ?? r[4]),
              volume: Number(r.v ?? r[5] ?? 0),
            }))
            .filter((c) =>
              isFinite(c.time) && isFinite(c.open) && isFinite(c.high) && isFinite(c.low) && isFinite(c.close),
            )
            .sort((a, b) => a.time - b.time);
          res.json({ ok: true, symbol: contract, interval, candles });
        } catch {
          res.status(502).json({ ok: false, error: "Invalid futures candle response" });
        }
      });
      upstream.on("error", () => res.status(502).json({ ok: false, error: "Gate.io futures candle stream failed" }));
    }).on("error", () => res.status(502).json({ ok: false, error: "Gate.io futures unreachable" }));
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
