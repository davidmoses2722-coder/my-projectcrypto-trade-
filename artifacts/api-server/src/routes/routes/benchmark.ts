import { Router, type Request, type Response } from "express";
import { startBenchmark, getBenchmarkState } from "../../services/benchmarkService";

const router = Router();

// POST /api/benchmark/start
router.post("/benchmark/start", async (req: Request, res: Response) => {
  const { symbol } = req.body as { symbol?: string };
  const result = await startBenchmark({ symbol });
  if (!result.ok) {
    return res.status(409).json({ ok: false, error: result.error });
  }
  return res.json({
    ok:      true,
    message: "Phase 8.5 benchmark started — running ActiveSwing + ConservativeScalping v2.1 across 5 symbols",
    symbols: ["BTC_USDT", "ETH_USDT", "SOL_USDT", "BNB_USDT", "XRP_USDT"],
  });
});

// GET /api/benchmark/status
router.get("/benchmark/status", (_req: Request, res: Response) => {
  const s = getBenchmarkState();
  return res.json({
    ok:                 true,
    status:             s.status,
    symbol:             s.symbol,
    symbols:            s.symbols,
    startedAt:          s.startedAt,
    completedAt:        s.completedAt,
    error:              s.error,
    progress:           s.progress,
    swingTrades:        null,                                    // disabled Phase 8.5
    activeSwingTrades:  s.activeSwing?.tradesCompleted ?? null,
    scalpingTrades:     s.scalping?.tradesCompleted ?? null,
  });
});

// GET /api/benchmark/results
router.get("/benchmark/results", (_req: Request, res: Response) => {
  const s = getBenchmarkState();
  if (s.status === "idle") {
    return res.status(404).json({ ok: false, error: "No benchmark has been run yet" });
  }
  if (s.status === "running") {
    return res.status(202).json({
      ok:       false,
      error:    "Benchmark is still running",
      status:   "running",
      progress: s.progress,
    });
  }
  if (s.status === "error") {
    return res.status(500).json({ ok: false, error: s.error });
  }
  return res.json({
    ok:            true,
    symbol:        s.symbol,
    symbols:       s.symbols,
    startedAt:     s.startedAt,
    completedAt:   s.completedAt,
    swing:         null,              // disabled Phase 8.5
    activeSwing:   s.activeSwing,
    scalping:      s.scalping,
    symbolResults: s.symbolResults,
    averages:      s.averages,
    // Phase 8.5 success criteria summary
    phase85: s.averages?.combined ? {
      targetMonthlyRoi:    "8–15%",
      targetProfitFactor:  "≥ 1.3",
      targetDrawdown:      "< 10%",
      targetTradesPerMonth: "30–50",
      result: {
        monthlyRoi:      s.averages.combined.blendedMonthlyRoi,
        profitFactor:    s.averages.combined.overallProfitFactor,
        maxDrawdown:     s.averages.combined.maxDrawdown,
        tradesPerMonth:  s.averages.combined.totalTradesPerMonth,
      },
      criteria:            s.averages.combined.criteria,
      passed: Object.values(s.averages.combined.criteria).filter(Boolean).length,
      total:  4,
    } : null,
  });
});

export default router;
