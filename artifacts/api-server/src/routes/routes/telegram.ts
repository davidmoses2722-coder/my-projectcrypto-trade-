import { Router, type IRouter, type Request, type Response } from "express";
import * as bot from "../../lib/bot";
import * as telegramNotifier from "../../lib/telegramNotifier";

const router: IRouter = Router();

// ── Backward-compat: kept so existing frontend Config tab still works ─────────
router.post("/test/telegram", async (req: Request, res: Response) => {
  const { token, chatId } = req.body ?? {};
  if (token || chatId) {
    bot.setConfig({ tgToken: token as string | undefined, tgChat: chatId as string | undefined });
  }
  const r = await bot.sendTelegram("✅ Pro Crypto Bot — Telegram test message");
  if (r.ok) res.json({ ok: true });
  else res.status(400).json({ ok: false, error: r.error });
});

// ── GET /api/telegram/status ──────────────────────────────────────────────────
router.get("/telegram/status", (_req: Request, res: Response) => {
  res.json(telegramNotifier.getStatus());
});

// ── POST /api/telegram/test ───────────────────────────────────────────────────
router.post("/telegram/test", async (_req: Request, res: Response) => {
  const r = await bot.sendTelegram("✅ Pro Crypto Bot — Telegram test message");
  if (r.ok) res.json({ ok: true, status: telegramNotifier.getStatus() });
  else res.status(400).json({ ok: false, error: r.error });
});

// ── POST /api/telegram/config ─────────────────────────────────────────────────
router.post("/telegram/config", (req: Request, res: Response) => {
  const { token, chatId, enabled } = req.body as {
    token?:   string;
    chatId?:  string;
    enabled?: boolean;
  };

  if (token !== undefined || chatId !== undefined) {
    bot.setConfig({
      tgToken: token,
      tgChat:  chatId,
    });
  }

  if (enabled !== undefined) {
    telegramNotifier.setEnabled(enabled);
  }

  res.json({ ok: true, status: telegramNotifier.getStatus() });
});

export default router;
