/**
 * conservativeScalping.ts — API routes for Conservative Scalping v2 counters/status
 */
import { Router, type Request, type Response } from "express";
import {
  getTradeCounters,
  getMonthlyProjection,
  STRATEGY_PARAMS,
  APPROVED_SYMBOLS,
} from "../../services/strategies/ConservativeScalpingStrategy";

const router = Router();

// GET /api/strategy/conservative-scalping/counters
router.get("/strategy/conservative-scalping/counters", (_req: Request, res: Response) => {
  const counters   = getTradeCounters();
  const projection = getMonthlyProjection();

  const today      = new Date().toISOString().slice(0, 10);
  const todayCount = counters.byDay[today] ?? 0;

  return res.json({
    ok: true,
    version:          "v2",
    month:            counters.month,
    monthlyTotal:     counters.total,
    monthlyCap:       STRATEGY_PARAMS.monthlyCap,
    dailyTotal:       todayCount,
    dailyCap:         STRATEGY_PARAMS.dailyCap,
    bySymbol:         counters.bySymbol,
    symbolMonthlyCap: STRATEGY_PARAMS.symbolMonthlyCap,
    projection:       projection,
    targetMin:        STRATEGY_PARAMS.targetMin,
    targetMax:        STRATEGY_PARAMS.targetMax,
    approvedSymbols:  APPROVED_SYMBOLS,
    params: {
      trendframe:     STRATEGY_PARAMS.trendframe,
      entryframe:     STRATEGY_PARAMS.entryframe,
      rsiBuyLow:      STRATEGY_PARAMS.rsiBuyLow,
      rsiBuyHigh:     STRATEGY_PARAMS.rsiBuyHigh,
      volumeRatio:    STRATEGY_PARAMS.volumeRatio,
      atrMinPct:      STRATEGY_PARAMS.atrMinPct,
      atrMaxPct:      STRATEGY_PARAMS.atrMaxPct,
      stopLossPct:    STRATEGY_PARAMS.slPct,
      takeProfitPct:  STRATEGY_PARAMS.tpPct,
      minConditions:  STRATEGY_PARAMS.minConditions,
    },
  });
});

export default router;
