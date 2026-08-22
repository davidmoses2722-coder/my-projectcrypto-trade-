import { Router, type Request, type Response } from "express";
import { tradeReviewEngine, type TradeContext } from "../../lib/tradeReviewEngine";

const router = Router();

router.post("/trade-review/generate", (req: Request, res: Response) => {
  try {
    const ctx = req.body as TradeContext;
    if (!ctx.tradeId || !ctx.symbol) {
      return res.status(400).json({ ok: false, error: "tradeId and symbol required" });
    }
    const review = tradeReviewEngine.generateReview(ctx);
    return res.status(201).json({ ok: true, data: review });
  } catch (err) {
    req.log.error({ err }, "trade-review: generate failed");
    return res.status(500).json({ ok: false, error: "Failed to generate review" });
  }
});

router.get("/trade-review/recent", (req: Request, res: Response) => {
  const limit = Number(req.query["limit"] ?? 20);
  res.json({ ok: true, data: tradeReviewEngine.getRecent(isNaN(limit) ? 20 : limit) });
});

router.get("/trade-review/stats", (_req: Request, res: Response) => {
  res.json({ ok: true, data: tradeReviewEngine.getStats() });
});

router.get("/trade-review/:tradeId", (req: Request, res: Response) => {
  const review = tradeReviewEngine.getReview(String(req.params["tradeId"] ?? ""));
  if (!review) return res.status(404).json({ ok: false, error: "Review not found" });
  return res.json({ ok: true, data: review });
});

export default router;
