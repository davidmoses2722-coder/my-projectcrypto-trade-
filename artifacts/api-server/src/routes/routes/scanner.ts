import { Router } from "express";
import * as scanner from "../../lib/multiSymbolScanner";

const router = Router();

router.get("/scanner/status", (_req, res) => {
  res.json(scanner.getStatus());
});

router.post("/scanner/start", (_req, res) => {
  if (scanner.isRunning()) {
    res.json({ ok: true, message: "Scanner already running" });
    return;
  }
  scanner.start();
  res.json({ ok: true, message: "Scanner started" });
});

router.post("/scanner/stop", (_req, res) => {
  if (!scanner.isRunning()) {
    res.json({ ok: true, message: "Scanner already stopped" });
    return;
  }
  scanner.stop();
  res.json({ ok: true, message: "Scanner stopped" });
});

export default router;
