/** Phase 15 — Strategy Profile Manager persistence layer. */
import { Router, type Request, type Response } from "express";
import * as store from "../../lib/store";

const router = Router();
const KEY = "phase15_strategy_profiles";

type Profile = {
  id: string;
  label: string;
  enabled: boolean;
  timeframe: string;
  minConfidence: number;
  tpPct: number;
  slPct: number;
  maxTradesPerDay: number;
  cooldownMinutes: number;
};

const DEFAULTS: Profile[] = [
  { id: "active-swing", label: "Active Swing", enabled: true, timeframe: "4h", minConfidence: 60, tpPct: 2, slPct: 1.2, maxTradesPerDay: 2, cooldownMinutes: 30 },
  { id: "conservative-scalping", label: "Conservative Scalping", enabled: true, timeframe: "5m", minConfidence: 65, tpPct: 1, slPct: 0.6, maxTradesPerDay: 6, cooldownMinutes: 5 },
  { id: "swing", label: "Swing", enabled: false, timeframe: "4h", minConfidence: 70, tpPct: 3, slPct: 1.5, maxTradesPerDay: 2, cooldownMinutes: 60 },
];

async function load(): Promise<Profile[]> {
  const raw = await store.getSetting(KEY);
  if (!raw) return DEFAULTS;
  try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : DEFAULTS; }
  catch { return DEFAULTS; }
}

router.get("/strategy-profiles", async (_req: Request, res: Response) => {
  res.json({ ok: true, profiles: await load() });
});

router.put("/strategy-profiles", async (req: Request, res: Response) => {
  const profiles = req.body?.profiles;
  if (!Array.isArray(profiles) || profiles.length === 0) {
    res.status(400).json({ ok: false, error: "profiles must be a non-empty array" }); return;
  }
  const clean = profiles.map((p: Partial<Profile>, i: number): Profile => ({
    id: String(p.id ?? `strategy-${i}`), label: String(p.label ?? p.id ?? `Strategy ${i + 1}`),
    enabled: Boolean(p.enabled), timeframe: String(p.timeframe ?? "1h"),
    minConfidence: Math.max(0, Math.min(100, Number(p.minConfidence ?? 60))),
    tpPct: Math.max(0.1, Math.min(50, Number(p.tpPct ?? 1))),
    slPct: Math.max(0.1, Math.min(50, Number(p.slPct ?? 1))),
    maxTradesPerDay: Math.max(1, Math.min(200, Number(p.maxTradesPerDay ?? 10))),
    cooldownMinutes: Math.max(0, Math.min(1440, Number(p.cooldownMinutes ?? 5))),
  }));
  await store.setSetting(KEY, JSON.stringify(clean));
  res.json({ ok: true, profiles: clean });
});

export default router;
