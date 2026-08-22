import { Router, type Request, type Response } from "express";
import { executionAnalytics } from "../../lib/executionAnalytics";

const router = Router();

router.get("/execution-analytics/summary", (req: Request, res: Response) => {
  try {
    const limit = Number(req.query["limit"] ?? 100);
    const summary = executionAnalytics.getSummary(isNaN(limit) ? 100 : limit);
    res.json({ ok: true, data: summary });
  } catch (err) {
    req.log.error({ err }, "execution-analytics: summary failed");
    res.status(500).json({ ok: false, error: "Failed to get execution summary" });
  }
});

router.get("/execution-analytics/records", (req: Request, res: Response) => {
  try {
    const limit = Number(req.query["limit"] ?? 100);
    const records = executionAnalytics.getRecords(isNaN(limit) ? 100 : limit);
    res.json({ ok: true, data: records });
  } catch (err) {
    req.log.error({ err }, "execution-analytics: records failed");
    res.status(500).json({ ok: false, error: "Failed to get execution records" });
  }
});

router.post("/execution-analytics/record", (req: Request, res: Response) => {
  try {
    const data = req.body as Parameters<typeof executionAnalytics.record>[0];
    if (!data.tradeId || !data.symbol) {
      return res.status(400).json({ ok: false, error: "tradeId and symbol required" });
    }
    const record = executionAnalytics.record(data);
    return res.json({ ok: true, data: record });
  } catch (err) {
    req.log.error({ err }, "execution-analytics: record failed");
    return res.status(500).json({ ok: false, error: "Failed to record execution" });
  }
});

router.delete("/execution-analytics/clear", (_req: Request, res: Response) => {
  executionAnalytics.clear();
  res.json({ ok: true, message: "Execution records cleared" });
});

export default router;
