import { Router, type Request, type Response } from "express";
import { buildStatus, pushLog } from "../../lib/bot";
import { orchestrator } from "../../lib/orchestrator";
import { positionSizingService } from "../../lib/positionSizingService";

// Wire the SSE log function into the orchestrator once at module load
orchestrator.setLogFn(pushLog);

const router = Router();

// ── GET /api/orchestrator/status ──────────────────────────────────────────────
/**
 * Compute and return the full orchestration status:
 * regime, strategy weights, allocations, intelligence rule verdicts.
 */
router.get("/orchestrator/status", (_req: Request, res: Response) => {
  try {
    const status      = buildStatus();
    const orchStatus  = orchestrator.compute(status);
    const sizingStatus = positionSizingService.getStatus(
      status.lastPrice ?? 0,
      (status.config?.stopLoss as number | undefined) ?? 0.009,
    );
    res.json({ ok: true, ...orchStatus, positionSizing: sizingStatus });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ── POST /api/orchestrator/config ─────────────────────────────────────────────
/**
 * Update orchestrator configuration.
 * Body: Partial<OrchestratorConfig>
 */
router.post("/orchestrator/config", (req: Request, res: Response) => {
  try {
    const patch = req.body ?? {};
    orchestrator.updateConfig(patch);
    const config = orchestrator.getConfig();
    res.json({ ok: true, config });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ── POST /api/orchestrator/override ──────────────────────────────────────────
/**
 * Manually override a strategy's weight or enabled state.
 * Body: { strategyId: string, patch: Partial<StrategyEntry>, clear?: boolean }
 */
router.post("/orchestrator/override", (req: Request, res: Response) => {
  try {
    const { strategyId, patch, clear } = req.body ?? {};
    if (!strategyId) {
      return res.status(400).json({ ok: false, error: "strategyId required" });
    }
    if (clear) {
      orchestrator.clearOverride(strategyId);
    } else {
      orchestrator.applyOverride(strategyId, patch ?? {});
    }
    const status = orchestrator.compute(buildStatus());
    return res.json({ ok: true, strategies: status.strategies });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

export default router;
