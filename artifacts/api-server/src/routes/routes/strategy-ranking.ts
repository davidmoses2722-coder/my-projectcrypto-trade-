import { Router, type Request, type Response } from "express";
import { strategyRankingService } from "../../lib/strategyRankingService";
import { db } from "@workspace/db";
import { tradesTable } from "@workspace/db/schema";

const router = Router();

router.get("/strategy-ranking", async (req: Request, res: Response) => {
  try {
    const allTrades = await db.select({
      reason:     tradesTable.reason,
      pnlUsd:     tradesTable.pnlUsd,
      executedAt: tradesTable.executedAt,
      kind:       tradesTable.kind,
    }).from(tradesTable);

    const summaries = allTrades
      .filter((t) => t.kind === "EXIT")
      .map((t) => ({
        strategyId: t.reason ?? "unknown",
        pnlUsd:     Number(t.pnlUsd ?? 0),
        closedAt:   t.executedAt ? new Date(t.executedAt).toISOString() : null,
        status:     "closed",
      }));

    const result = strategyRankingService.compute(summaries);
    res.json({ ok: true, data: result });
  } catch (err) {
    req.log.error({ err }, "strategy-ranking: failed");
    res.status(500).json({ ok: false, error: "Failed to compute strategy rankings" });
  }
});

router.post("/strategy-ranking/invalidate", (_req: Request, res: Response) => {
  strategyRankingService.invalidate();
  res.json({ ok: true, message: "Cache invalidated" });
});

export default router;
