import { Router, type Request, type Response } from "express";
import { livePerformanceVerifier, type PerformanceLayer } from "../../lib/livePerformanceVerifier";

const router = Router();

router.get("/live-performance/report", (req: Request, res: Response) => {
  const period = (req.query["period"] as string | undefined) ?? "30d";
  const report = livePerformanceVerifier.getVerificationReport(undefined, period);
  res.json({ ok: true, data: report });
});

router.get("/live-performance/snapshots", (req: Request, res: Response) => {
  const filter = {
    layer:      req.query["layer"]      as PerformanceLayer | undefined,
    strategyId: req.query["strategyId"] as string | undefined,
    period:     req.query["period"]     as string | undefined,
  };
  const snaps = livePerformanceVerifier.getSnapshots(filter);
  res.json({ ok: true, data: snaps });
});

router.get("/live-performance/drift/:strategyId", (req: Request, res: Response) => {
  const period = (req.query["period"] as string | undefined) ?? "30d";
  const drift  = livePerformanceVerifier.computeDrift(String(req.params["strategyId"] ?? ""), period);
  res.json({ ok: true, data: drift });
});

router.post("/live-performance/snapshot", (req: Request, res: Response) => {
  try {
    const snap = req.body as Parameters<typeof livePerformanceVerifier.recordSnapshot>[0];
    if (!snap.strategyId || !snap.layer) {
      return res.status(400).json({ ok: false, error: "strategyId and layer required" });
    }
    livePerformanceVerifier.recordSnapshot(snap);
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "live-performance: snapshot failed");
    return res.status(500).json({ ok: false, error: "Failed to record snapshot" });
  }
});

export default router;
