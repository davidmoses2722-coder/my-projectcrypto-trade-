import { Router, type Request, type Response } from "express";
import { portfolioManager, type RiskPreset } from "../../lib/portfolioManager";

const router = Router();

router.get("/portfolio-manager", (_req: Request, res: Response) => {
  res.json({ ok: true, data: portfolioManager.getSummaries() });
});

router.get("/portfolio-manager/active", (_req: Request, res: Response) => {
  const active = portfolioManager.getActive();
  res.json({ ok: true, data: active });
});

router.get("/portfolio-manager/:id", (req: Request, res: Response) => {
  const p = portfolioManager.getById(String(req.params["id"] ?? ""));
  if (!p) return res.status(404).json({ ok: false, error: "Portfolio not found" });
  return res.json({ ok: true, data: p });
});

router.post("/portfolio-manager", (req: Request, res: Response) => {
  try {
    const { name, description = "", riskPreset = "balanced", totalCapitalUsdt = 1000 } = req.body as {
      name?: string; description?: string; riskPreset?: RiskPreset; totalCapitalUsdt?: number;
    };
    if (!name) return res.status(400).json({ ok: false, error: "name required" });
    const p = portfolioManager.create({ name, description, riskPreset, totalCapitalUsdt });
    return res.status(201).json({ ok: true, data: p });
  } catch (err) {
    req.log.error({ err }, "portfolio-manager: create failed");
    return res.status(500).json({ ok: false, error: "Failed to create portfolio" });
  }
});

router.patch("/portfolio-manager/:id", (req: Request, res: Response) => {
  const updated = portfolioManager.update(String(req.params["id"] ?? ""), req.body);
  if (!updated) return res.status(404).json({ ok: false, error: "Portfolio not found" });
  return res.json({ ok: true, data: updated });
});

router.post("/portfolio-manager/:id/activate", (req: Request, res: Response) => {
  const ok = portfolioManager.activate(String(req.params["id"] ?? ""));
  if (!ok) return res.status(404).json({ ok: false, error: "Portfolio not found" });
  return res.json({ ok: true, message: "Portfolio activated" });
});

router.post("/portfolio-manager/:id/apply-preset", (req: Request, res: Response) => {
  const { preset } = req.body as { preset?: RiskPreset };
  if (!preset) return res.status(400).json({ ok: false, error: "preset required" });
  const updated = portfolioManager.applyPreset(String(req.params["id"] ?? ""), preset);
  if (!updated) return res.status(404).json({ ok: false, error: "Portfolio not found" });
  return res.json({ ok: true, data: updated });
});

router.delete("/portfolio-manager/:id", (req: Request, res: Response) => {
  const deleted = portfolioManager.delete(String(req.params["id"] ?? ""));
  if (!deleted) return res.status(404).json({ ok: false, error: "Portfolio not found" });
  return res.json({ ok: true, message: "Deleted" });
});

export default router;
