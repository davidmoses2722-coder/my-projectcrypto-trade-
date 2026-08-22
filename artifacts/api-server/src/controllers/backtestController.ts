import type { Request, Response } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { backtestsTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { runBacktest } from "../services/backtestEngine";
import { logger } from "../lib/logger";

const RunSchema = z.object({
  strategy:       z.enum(["scalping", "day-trading", "swing", "dca", "grid"]),
  symbol:         z.string().min(1).max(20).transform((s: string) => s.toUpperCase()),
  timeframe:      z.enum(["1m", "5m", "15m", "30m", "1h", "4h", "1d"]).default("1h"),
  startDate:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD required"),
  endDate:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD required"),
  initialBalance: z.number().min(10).max(1_000_000).default(1000),
  tradingFeesPct: z.number().min(0).max(5).default(0.1),
  slippagePct:    z.number().min(0).max(5).default(0.05),
  riskProfile:    z.enum(["low", "medium", "high", "custom"]).default("medium"),
  positionSizing: z.boolean().default(true),
});

function uid(req: Request): number | null {
  return (req as Request & { user?: { uid?: number } }).user?.uid ?? null;
}

// POST /api/backtest/run
export async function runBacktestHandler(req: Request, res: Response): Promise<void> {
  const parsed = RunSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: "Invalid parameters", details: parsed.error.issues });
    return;
  }
  const p = parsed.data;
  const fromMs = new Date(p.startDate).getTime();
  const toMs   = new Date(p.endDate).getTime();
  if (isNaN(fromMs) || isNaN(toMs) || toMs <= fromMs) {
    res.status(400).json({ ok: false, error: "endDate must be after startDate" });
    return;
  }
  if ((toMs - fromMs) / 86_400_000 > 730) {
    res.status(400).json({ ok: false, error: "Max range is 730 days" });
    return;
  }

  let btId: number;
  try {
    const [row] = await db.insert(backtestsTable).values({
      userId: uid(req), strategy: p.strategy, symbol: p.symbol,
      timeframe: p.timeframe, startDate: p.startDate, endDate: p.endDate,
      initialBalance: String(p.initialBalance), tradingFeesPct: String(p.tradingFeesPct),
      slippagePct: String(p.slippagePct), riskProfile: p.riskProfile,
      positionSizing: p.positionSizing, status: "running",
    }).returning({ id: backtestsTable.id });
    if (!row) throw new Error("No row");
    btId = row.id;
  } catch (e) {
    logger.error({ err: e }, "backtest: insert failed");
    res.status(500).json({ ok: false, error: "DB error" });
    return;
  }

  try {
    const result = await runBacktest(p);
    await db.update(backtestsTable).set({
      status: "completed", finalBalance: String(result.metrics.finalBalance),
      metrics: result.metrics, charts: result.charts, trades: result.trades,
      durationMs: result.durationMs, candlesUsed: result.candlesUsed, completedAt: new Date(),
    }).where(eq(backtestsTable.id, btId));
    res.json({ ok: true, id: btId, result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error({ err: e, btId }, "backtest: sim failed");
    await db.update(backtestsTable).set({ status: "failed", errorMessage: msg })
      .where(eq(backtestsTable.id, btId)).catch(() => {});
    res.status(500).json({ ok: false, id: btId, error: msg });
  }
}

// GET /api/backtest/results/:id
export async function getBacktestResult(req: Request, res: Response): Promise<void> {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ ok: false, error: "Invalid id" }); return; }
  try {
    const [row] = await db.select().from(backtestsTable).where(eq(backtestsTable.id, id)).limit(1);
    if (!row) { res.status(404).json({ ok: false, error: "Not found" }); return; }
    res.json({ ok: true, backtest: row });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
}

// GET /api/backtest/history
export async function getBacktestHistory(req: Request, res: Response): Promise<void> {
  const userId = uid(req);
  const limit  = Math.min(parseInt(String(req.query.limit ?? "50"), 10), 200);
  try {
    const cols = {
      id: backtestsTable.id, strategy: backtestsTable.strategy, symbol: backtestsTable.symbol,
      timeframe: backtestsTable.timeframe, startDate: backtestsTable.startDate,
      endDate: backtestsTable.endDate, initialBalance: backtestsTable.initialBalance,
      finalBalance: backtestsTable.finalBalance, riskProfile: backtestsTable.riskProfile,
      positionSizing: backtestsTable.positionSizing, status: backtestsTable.status,
      metrics: backtestsTable.metrics, durationMs: backtestsTable.durationMs,
      candlesUsed: backtestsTable.candlesUsed, errorMessage: backtestsTable.errorMessage,
      createdAt: backtestsTable.createdAt, completedAt: backtestsTable.completedAt,
    };
    const rows = userId
      ? await db.select(cols).from(backtestsTable).where(eq(backtestsTable.userId, userId)).orderBy(desc(backtestsTable.createdAt)).limit(limit)
      : await db.select(cols).from(backtestsTable).orderBy(desc(backtestsTable.createdAt)).limit(limit);
    res.json({ ok: true, backtests: rows, count: rows.length });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
}
