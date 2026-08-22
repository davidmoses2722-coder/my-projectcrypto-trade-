import { Router, type Request, type Response } from "express";
import { runOptimizer, type OptimizerParams } from "../../lib/optimizerEngine";
import { resolveStrategy, type StrategyId } from "../../services/strategies/index";
import { toCcxtSymbol } from "../../services/tradeService";
import ccxt from "ccxt";

const router = Router();

router.post("/optimizer/run", async (req: Request, res: Response) => {
  try {
    const {
      strategyId       = "swing",
      symbol           = "BTC/USDT",
      timeframe        = "1h",
      limit            = 500,
      maxCombinations  = 300,
      rsiRange,
      ema1Range,
      ema2Range,
      tpRange,
      slRange,
      atrRange,
    } = req.body as Partial<{
      strategyId:      string;
      symbol:          string;
      timeframe:       string;
      limit:           number;
      maxCombinations: number;
      rsiRange:        { min: number; max: number; step: number };
      ema1Range:       { min: number; max: number; step: number };
      ema2Range:       { min: number; max: number; step: number };
      tpRange:         { min: number; max: number; step: number };
      slRange:         { min: number; max: number; step: number };
      atrRange:        { min: number; max: number; step: number };
    }>;

    // Fetch candles — normalise to ccxt BTC/USDT format
    const exchange = new ccxt.gate({ enableRateLimit: true });
    const raw = await exchange.fetchOHLCV(toCcxtSymbol(symbol), timeframe, undefined, Math.min(limit, 1000));
    if (!raw || raw.length < 50) {
      return res.status(400).json({ ok: false, error: "Insufficient candle data" });
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

    // Simulation function using parameter set
    const simulateFn = (cfg: { rsi: number; ema1: number; ema2: number; tp: number; sl: number; atr: number }) => {
      let balance = 1000;
      const initial = balance;
      let openPos: { entryPrice: number; sl: number; tp: number } | null = null;
      let wins = 0, losses = 0;
      let peak = balance;
      let maxDD = 0;
      const returns: number[] = [];

      for (let i = Math.max(cfg.ema2, 50); i < candles.length; i++) {
        const window = candles.slice(Math.max(0, i - 200), i);

        if (openPos) {
          const price = candles[i]!.close;
          if (price <= openPos.sl) {
            const ret = (price - openPos.entryPrice) / openPos.entryPrice;
            balance  *= (1 + ret * 0.1);
            losses++;
            returns.push(ret);
            openPos = null;
          } else if (price >= openPos.tp) {
            const ret = (price - openPos.entryPrice) / openPos.entryPrice;
            balance  *= (1 + ret * 0.1);
            wins++;
            returns.push(ret);
            openPos = null;
          }
          if (balance > peak) peak = balance;
          const dd = (peak - balance) / peak * 100;
          if (dd > maxDD) maxDD = dd;
          continue;
        }

        const sig = strategyEntry.fn({
          candles: window.map((c) => ({ time: new Date(c.time).getTime(), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume })),
          currentPrice: candles[i]!.close,
          dailyTradeCount: 0,
        });
        if (sig.action === "BUY") {
          const ep = candles[i]!.close;
          openPos = { entryPrice: ep, sl: ep * (1 - cfg.sl / 100), tp: ep * (1 + cfg.tp / 100) };
        }
      }

      const totalTrades = wins + losses;
      const winRate     = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
      const netReturn   = ((balance - initial) / initial) * 100;
      const grossWin    = returns.filter((r) => r > 0).reduce((s, v) => s + v, 0);
      const grossLoss   = Math.abs(returns.filter((r) => r < 0).reduce((s, v) => s + v, 0));
      const pf          = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : 0;
      const mean        = returns.length > 0 ? returns.reduce((s, v) => s + v, 0) / returns.length : 0;
      const std         = returns.length > 1 ? Math.sqrt(returns.reduce((s, v) => s + (v - mean) ** 2, 0) / returns.length) : 0;
      const sharpe      = std > 0 ? (mean / std) * Math.sqrt(252) : 0;

      return { returnPct: netReturn, winRate, profitFactor: pf, sharpeRatio: sharpe, maxDrawdown: maxDD, totalTrades };
    };

    const result = runOptimizer({
      strategyId, symbol,
      rsiRange, ema1Range, ema2Range, tpRange, slRange, atrRange,
      maxCombinations: Math.min(maxCombinations, 500),
      simulateFn,
    } as OptimizerParams);

    return res.json({ ok: true, data: result });
  } catch (err) {
    req.log.error({ err }, "optimizer: run failed");
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

export default router;
