/**
 * activeSwing.ts — API routes for Active Swing Strategy counters/status
 */
import { Router, type Request, type Response } from "express";
import {
  getTradeCounters,
  getMonthlyProjection,
  STRATEGY_PARAMS,
  APPROVED_SYMBOLS,
} from "../../services/strategies/ActiveSwingStrategy";

const router = Router();

// GET /api/strategy/active-swing/counters
// Returns monthly/daily/symbol trade counts and monthly projection
router.get("/strategy/active-swing/counters", (_req: Request, res: Response) => {
  const counters = getTradeCounters();
  const projection = getMonthlyProjection();

  const today = new Date().toISOString().slice(0, 10);
  const todayCount = counters.byDay[today] ?? 0;

  return res.json({
    ok: true,
    month:            counters.month,
    monthlyTotal:     counters.total,
    monthlyCap:       STRATEGY_PARAMS.monthlyCap,
    dailyTotal:       todayCount,
    dailyCap:         STRATEGY_PARAMS.dailyCap,
    bySymbol:         counters.bySymbol,
    symbolMonthlyCap: STRATEGY_PARAMS.symbolMonthlyCap,
    projection:       projection,
    targetMin:        20,
    targetMax:        30,
    approvedSymbols:  APPROVED_SYMBOLS,
    params: {
      rsiBuyMin:      STRATEGY_PARAMS.rsiBuyMin,
      rsiBuyMax:      STRATEGY_PARAMS.rsiBuyMax,
      minVolumeRatio: STRATEGY_PARAMS.minVolumeRatio,
      atrMinPct:      STRATEGY_PARAMS.atrMinPct,
      atrMaxPct:      STRATEGY_PARAMS.atrMaxPct,
      stopLossPct:    STRATEGY_PARAMS.stopLossPct,
      takeProfitPct:  STRATEGY_PARAMS.takeProfitPct,
    },
  });
});

export default router;
