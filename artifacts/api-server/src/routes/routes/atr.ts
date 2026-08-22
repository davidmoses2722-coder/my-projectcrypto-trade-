/**
 * /api/atr/* — ATR health and log endpoints (Phase 12.1)
 *
 * GET /api/atr/health   → overall health + per-symbol snapshots + recent log entries
 * GET /api/atr/logs     → paginated ATR log ring buffer (last N entries)
 *
 * These are public (no auth) so the frontend can display a health badge without
 * requiring the user to be logged in, matching the bot-log SSE pattern.
 */

import { Router, type Request, type Response } from "express";
import {
  getAtrLogs,
  getAtrSnapshots,
  getOverallHealth,
} from "../../lib/atrValidator";

const router = Router();

/** Overall ATR health status + per-symbol snapshot + 50 most-recent log entries */
router.get("/atr/health", (_req: Request, res: Response) => {
  res.json({
    ok:        true,
    health:    getOverallHealth(),
    snapshots: getAtrSnapshots(),
    recentLogs: getAtrLogs().slice(-50),
    ts:        new Date().toISOString(),
  });
});

/** Full ATR log ring buffer (up to 200 entries), newest-first */
router.get("/atr/logs", (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit) || 100, 200);
  const all   = getAtrLogs().reverse();
  res.json({
    ok:     true,
    total:  all.length,
    logs:   all.slice(0, limit),
  });
});

export default router;
