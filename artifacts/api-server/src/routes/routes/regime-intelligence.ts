import { Router, type Request, type Response } from "express";
import { regimeIntelligence } from "../../lib/regimeIntelligence";
import { toCcxtSymbol } from "../../services/tradeService";
import ccxt from "ccxt";

const router = Router();

router.post("/regime-intelligence/analyze", async (req: Request, res: Response) => {
  try {
    const {
      symbol    = "BTC/USDT",
      timeframe = "1h",
      limit     = 200,
      rsi,
      ema50,
      ema200,
    } = req.body as {
      symbol?:    string;
      timeframe?: string;
      limit?:     number;
      rsi?:       number;
      ema50?:     number;
      ema200?:    number;
    };

    const exchange = new ccxt.gate({ enableRateLimit: true });
    const raw = await exchange.fetchOHLCV(toCcxtSymbol(symbol), timeframe, undefined, Math.min(limit, 500));

    if (!raw || raw.length < 30) {
      return res.status(400).json({ ok: false, error: "Insufficient candle data" });
    }

    const candles = raw.map((c) => ({ high: c[2]!, low: c[3]!, close: c[4]! }));
    const result  = regimeIntelligence.compute(candles, { rsi, ema50, ema200 });
    return res.json({ ok: true, data: result });
  } catch (err) {
    req.log.error({ err }, "regime-intelligence: analyze failed");
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

router.get("/regime-intelligence/last", (_req: Request, res: Response) => {
  const last = regimeIntelligence.getLast();
  if (!last) return res.status(404).json({ ok: false, error: "No regime computed yet" });
  return res.json({ ok: true, data: last });
});

export default router;
