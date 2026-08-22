import { Router, type Request, type Response } from "express";
import { correlationRiskEngine } from "../../lib/correlationRiskEngine";

const router = Router();

router.get("/correlation-risk/config", (_req: Request, res: Response) => {
  res.json({ ok: true, data: correlationRiskEngine.getConfig() });
});

router.patch("/correlation-risk/config", (req: Request, res: Response) => {
  try {
    correlationRiskEngine.configure(req.body as Parameters<typeof correlationRiskEngine.configure>[0]);
    res.json({ ok: true, data: correlationRiskEngine.getConfig() });
  } catch (err) {
    req.log.error({ err }, "correlation-risk: configure failed");
    res.status(500).json({ ok: false, error: "Failed to update config" });
  }
});

router.post("/correlation-risk/check", (req: Request, res: Response) => {
  try {
    const { symbol, openPositions = [] } = req.body as { symbol?: string; openPositions?: string[] };
    if (!symbol) return res.status(400).json({ ok: false, error: "symbol required" });
    const decision = correlationRiskEngine.checkEntry(symbol, openPositions);
    return res.json({ ok: true, data: decision });
  } catch (err) {
    req.log.error({ err }, "correlation-risk: check failed");
    return res.status(500).json({ ok: false, error: "Failed to check correlation" });
  }
});

router.post("/correlation-risk/matrix", (req: Request, res: Response) => {
  try {
    const { symbols = ["BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "DOGE/USDT"] } = req.body as { symbols?: string[] };
    const matrix = correlationRiskEngine.getMatrix(symbols);
    res.json({ ok: true, data: matrix });
  } catch (err) {
    req.log.error({ err }, "correlation-risk: matrix failed");
    res.status(500).json({ ok: false, error: "Failed to compute matrix" });
  }
});

router.post("/correlation-risk/price", (req: Request, res: Response) => {
  try {
    const { symbol, price } = req.body as { symbol?: string; price?: number };
    if (!symbol || price == null) return res.status(400).json({ ok: false, error: "symbol and price required" });
    correlationRiskEngine.recordPrice(symbol, price);
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "correlation-risk: price record failed");
    return res.status(500).json({ ok: false, error: "Failed to record price" });
  }
});

export default router;
