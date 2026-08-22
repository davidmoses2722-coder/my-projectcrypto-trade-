import { Router, type Request, type Response } from "express";
import { runWalkForward, type WalkForwardSplit } from "../../lib/walkForwardEngine";
import { resolveStrategy, type StrategyId } from "../../services/strategies/index";
import { toCcxtSymbol } from "../../services/tradeService";
import ccxt from "ccxt";

const router = Router();

router.post("/walk-forward/run", async (req: Request, res: Response) => {
  try {
    const {
      strategyId  = "swing",
      symbol      = "BTC/USDT",
      timeframe   = "1h",
      trainSplit  = 70,
      limit       = 500,
    } = req.body as {
      strategyId?: string;
      symbol?:     string;
      timeframe?:  string;
      trainSplit?: number;
      limit?:      number;
    };

    const splitPct = ([60, 70, 80].includes(trainSplit) ? trainSplit : 70) as WalkForwardSplit;

    // Fetch candles from Gate.io — normalise to ccxt BTC/USDT format
    const exchange = new ccxt.gate({ enableRateLimit: true });
    const raw = await exchange.fetchOHLCV(toCcxtSymbol(symbol), timeframe, undefined, Math.min(limit, 1000));
    if (!raw || raw.length < 100) {
      return res.status(400).json({ ok: false, error: "Insufficient candle data for walk-forward analysis" });
    }

    const candles = raw.map((c) => ({
      time:   new Date(c[0]!).toISOString(),
      open:   c[1]!,
      high:   c[2]!,
      low:    c[3]!,
      close:  c[4]!,
      volume: c[5]!,
    }));

    const strategyEntry = resolveStrategy(strategyId as StrategyId);

    // Simulate function for a slice of candles
    const simulateFn = (startIdx: number, endIdx: number): { returnPct: number; trades: number; winRate: number } => {
      const slice = candles.slice(startIdx, endIdx);
      if (slice.length < 20) return { returnPct: 0, trades: 0, winRate: 0 };

      let balance = 1000;
      const initial = balance;
      let openPos: { entryPrice: number; sl: number; tp: number } | null = null;
      let wins = 0, losses = 0;

      for (let i = 20; i < slice.length; i++) {
        const window = slice.slice(Math.max(0, i - 100), i);

        if (openPos) {
          const price = slice[i]!.close;
          if (price <= openPos.sl) {
            balance -= (openPos.entryPrice - price) / openPos.entryPrice * balance * 0.1;
            losses++;
            openPos = null;
          } else if (price >= openPos.tp) {
            balance += (price - openPos.entryPrice) / openPos.entryPrice * balance * 0.1;
            wins++;
            openPos = null;
          }
          continue;
        }

        const sig = strategyEntry.fn({
          candles: window.map((c) => ({ time: new Date(c.time).getTime(), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume })),
          currentPrice: slice[i]!.close,
          dailyTradeCount: 0,
        });

        if (sig.action === "BUY" && !openPos) {
          const ep = slice[i]!.close;
          openPos = { entryPrice: ep, sl: ep * 0.98, tp: ep * 1.02 };
        }
      }

      const totalTrades = wins + losses;
      const returnPct   = ((balance - initial) / initial) * 100;
      const winRate     = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
      return { returnPct, trades: totalTrades, winRate };
    };

    const result = runWalkForward({ strategyId, symbol, trainSplitPct: splitPct, candles, simulateFn });
    return res.json({ ok: true, data: result });
  } catch (err) {
    req.log.error({ err }, "walk-forward: run failed");
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

export default router;
