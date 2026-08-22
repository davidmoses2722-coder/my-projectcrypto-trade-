/** Phase 15 — Copy Trading foundation.
 * Stores follower preferences now; actual cross-user trade replication remains gated
 * behind a future multi-account execution/permission model.
 */
import { Router, type Request, type Response } from "express";
import * as store from "../../lib/store";

const router = Router();
const KEY = "phase15_copy_trading_settings";
const DEFAULTS = { enabled: false, allocationPct: 10, maxPositionUsdt: 100, maxDailyLossUsdt: 20, maxConcurrentCopies: 3, copyNewTradesOnly: true };

router.get("/copy-trading/settings", async (_req: Request, res: Response) => {
  const raw = await store.getSetting(KEY);
  let settings = DEFAULTS;
  if (raw) { try { settings = { ...DEFAULTS, ...JSON.parse(raw) }; } catch { /* defaults */ } }
  res.json({ ok: true, settings, capabilities: { followerPreferences: true, traderDiscovery: true, liveReplication: false, note: "Live cross-user replication requires multi-account permissions and is not enabled in Phase 15." } });
});

router.put("/copy-trading/settings", async (req: Request, res: Response) => {
  const b = req.body ?? {};
  const settings = {
    enabled: Boolean(b.enabled),
    allocationPct: Math.max(1, Math.min(100, Number(b.allocationPct ?? 10))),
    maxPositionUsdt: Math.max(5, Number(b.maxPositionUsdt ?? 100)),
    maxDailyLossUsdt: Math.max(1, Number(b.maxDailyLossUsdt ?? 20)),
    maxConcurrentCopies: Math.max(1, Math.min(20, Number(b.maxConcurrentCopies ?? 3))),
    copyNewTradesOnly: b.copyNewTradesOnly !== false,
  };
  await store.setSetting(KEY, JSON.stringify(settings));
  res.json({ ok: true, settings });
});

router.get("/copy-trading/leaders", (_req: Request, res: Response) => {
  res.json({ ok: true, leaders: [], message: "Trader discovery API is ready. Public trader profiles will populate after multi-user trading accounts are enabled." });
});

export default router;
