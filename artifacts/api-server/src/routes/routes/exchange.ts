import { Router, type IRouter, type Request, type Response } from "express";
import * as bot from "../../lib/bot";

/**
 * Exchange routes — kept under /binance/* and /gateio/* for frontend compat.
 * They both call the same Gate.io-backed implementation.
 */

const router: IRouter = Router();

async function pingHandler(_req: Request, res: Response) {
  try {
    const r = await bot.pingExchange();
    res.json({ ok: r.ok, latencyMs: r.latencyMs, method: "gateio-rest", serverTime: r.serverTime });
  } catch (e) {
    res.status(502).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}

async function testAuthHandler(req: Request, res: Response) {
  const { apiKey, secretKey, passphrase } = req.body ?? {};
  const r = await bot.testKeys({ apiKey, secretKey, passphrase });
  if (!r.ok) {
    res.status(400).json({ ok: false, error: r.error });
    return;
  }
  // Try to fetch balance for nicer UI; fall back gracefully if it fails
  let balance = 0;
  let accountType = "Gate.io Spot";
  try {
    const bal = await bot.fetchBalanceWith({ apiKey, secretKey, passphrase });
    balance = bal.totalEqUsd;
  } catch (e) {
    accountType = `Gate.io (balance fetch failed: ${e instanceof Error ? e.message : String(e)})`;
  }
  res.json({ ok: true, balance, canTrade: true, accountType });
}

async function validateHandler(req: Request, res: Response) {
  const r = await bot.validateAndSave(req.body ?? {});
  if (r.ok) res.json({ ok: true, ...bot.buildStatus() });
  else res.status(400).json({ ok: false, error: r.error });
}

// Legacy "binance" paths the frontend already calls
router.post("/binance/ping", pingHandler);
router.post("/binance/test-auth", testAuthHandler);
router.post("/binance/validate", validateHandler);

// Gate.io paths (preferred going forward)
router.post("/gateio/ping", pingHandler);
router.post("/gateio/test-auth", testAuthHandler);
router.post("/gateio/validate", validateHandler);

export default router;
