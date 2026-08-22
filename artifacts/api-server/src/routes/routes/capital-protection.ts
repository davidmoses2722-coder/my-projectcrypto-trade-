import { Router, type Request, type Response } from "express";
import { capitalProtectionService } from "../../lib/capitalProtectionService";

const router = Router();

router.get("/capital-protection/status", (req: Request, res: Response) => {
  try {
    const status = capitalProtectionService.getStatus();
    res.json({ ok: true, data: status });
  } catch (err) {
    req.log.error({ err }, "capital-protection: status failed");
    res.status(500).json({ ok: false, error: "Failed to get protection status" });
  }
});

router.get("/capital-protection/config", (req: Request, res: Response) => {
  res.json({ ok: true, data: capitalProtectionService.getConfig() });
});

router.patch("/capital-protection/config", (req: Request, res: Response) => {
  try {
    capitalProtectionService.configure(req.body as Parameters<typeof capitalProtectionService.configure>[0]);
    res.json({ ok: true, data: capitalProtectionService.getConfig() });
  } catch (err) {
    req.log.error({ err }, "capital-protection: configure failed");
    res.status(500).json({ ok: false, error: "Failed to update config" });
  }
});

router.post("/capital-protection/evaluate", (req: Request, res: Response) => {
  try {
    const { equity } = req.body as { equity?: number };
    if (equity == null || isNaN(equity)) {
      return res.status(400).json({ ok: false, error: "equity (number) required" });
    }
    const status = capitalProtectionService.evaluate(equity);
    return res.json({ ok: true, data: status });
  } catch (err) {
    req.log.error({ err }, "capital-protection: evaluate failed");
    return res.status(500).json({ ok: false, error: "Failed to evaluate equity" });
  }
});

router.post("/capital-protection/emergency", (req: Request, res: Response) => {
  const { action } = req.body as { action?: "trigger" | "reset" };
  if (action === "trigger") {
    capitalProtectionService.triggerEmergency();
    return res.json({ ok: true, message: "Emergency kill switch activated" });
  }
  if (action === "reset") {
    capitalProtectionService.resetEmergency();
    return res.json({ ok: true, message: "Emergency kill switch reset" });
  }
  return res.status(400).json({ ok: false, error: "action must be 'trigger' or 'reset'" });
});

export default router;
