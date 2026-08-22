/**
 * opportunities.ts — GET /api/opportunities
 *
 * Scans 10 symbols with ActiveSwingStrategy and returns per-symbol
 * condition counts, readiness scores, and confidence.
 *
 * Results are cached for 5 minutes. Pass ?refresh=1 to force a fresh scan.
 */

import { Router, type Request, type Response } from "express";
import {
  runOpportunityScanner,
  getOpportunities,
} from "../../services/opportunityScanner";

const router = Router();

// GET /api/opportunities
// Returns cached results (< 5 min) or triggers a fresh scan.
// Query param: ?refresh=1 forces a new scan ignoring cache.
router.get("/opportunities", async (req: Request, res: Response) => {
  try {
    const forceRefresh = req.query["refresh"] === "1";

    const cached = getOpportunities();
    if (!forceRefresh && cached.results.length > 0 && cached.ageMs < 5 * 60 * 1000) {
      return res.json({
        ok:        true,
        fromCache: true,
        ...cached,
      });
    }

    // Kick off scan and await results (may take 15–30 s for 10 symbols)
    const results = await runOpportunityScanner();
    const updated = getOpportunities();

    return res.json({
      ok:        true,
      fromCache: false,
      ...updated,
      results,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ ok: false, error: msg });
  }
});

// GET /api/opportunities/cached
// Returns whatever is in cache instantly (no scan triggered).
router.get("/opportunities/cached", (_req: Request, res: Response) => {
  return res.json({ ok: true, ...getOpportunities() });
});

export default router;
