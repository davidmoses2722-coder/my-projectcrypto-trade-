import { Router, type IRouter, type Request, type Response } from "express";
import { handleUpdate, getWebhookSecret } from "../../lib/telegramWebhook";

const router: IRouter = Router();

/**
 * POST /api/telegram/webhook
 * Public — Telegram calls this with incoming updates.
 * Verified via X-Telegram-Bot-Api-Secret-Token header.
 */
router.post("/telegram/webhook", (req: Request, res: Response) => {
  const secret   = getWebhookSecret();
  const incoming = req.headers["x-telegram-bot-api-secret-token"];

  if (secret && incoming !== secret) {
    res.status(403).json({ ok: false });
    return;
  }

  res.json({ ok: true });

  void handleUpdate(req.body as Parameters<typeof handleUpdate>[0]);
});

export default router;
