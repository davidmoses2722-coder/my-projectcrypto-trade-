import { Router, type IRouter, type Request, type Response } from "express";
import * as exchangeService from "../../services/exchangeService";
import * as apiKeyService from "../../services/apiKeyService";
import * as bot from "../../lib/bot";

/**
 * Exchange routes (Gate.io).
 *
 * Auth: every route in this file is mounted behind `requireAuth`, so
 * `req.user!.uid` is always present. We scope every API-key read/write
 * by that user — keys are NEVER returned in any response (only masked
 * summaries from `apiKeyService.getMaskedSummary` / `summariseCreds`).
 */

const router: IRouter = Router();

function uid(req: Request): number {
  // requireAuth middleware (mounted in routes/index.ts) guarantees req.user.
  return req.user!.uid;
}

router.get("/exchanges", async (req: Request, res: Response) => {
  const userId = uid(req);
  const supported = exchangeService.listSupported();
  const active = exchangeService.getActiveExchange();
  const summaries = await Promise.all(
    supported.map((e) => exchangeService.summariseCreds(e.id, userId)),
  );
  res.json({
    ok: true,
    data: {
      active,
      supported: supported.map((meta, i) => ({ ...meta, ...summaries[i] })),
    },
  });
});

router.post("/exchanges/select", async (req: Request, res: Response) => {
  const userId = uid(req);
  const id = String(req.body?.exchange ?? "").toLowerCase();
  if (!exchangeService.isSupported(id)) {
    res.status(400).json({ ok: false, error: `Unsupported exchange: ${id}`, code: "BAD_EXCHANGE" });
    return;
  }
  exchangeService.setActiveExchange(id);
  bot.setActiveExchange(id, userId);
  res.json({ ok: true, data: { active: id, status: bot.buildStatus() } });
});

router.post("/exchanges/save-keys", async (req: Request, res: Response) => {
  const userId = uid(req);
  const { exchange, apiKey, secret, passphrase, paper, label } = req.body ?? {};
  if (!exchangeService.isSupported(String(exchange))) {
    res
      .status(400)
      .json({ ok: false, error: `Unsupported exchange: ${exchange}`, code: "BAD_EXCHANGE" });
    return;
  }
  const r = await exchangeService.saveAndValidate({
    userId,
    exchange: exchange as exchangeService.ExchangeId,
    apiKey: String(apiKey ?? ""),
    secret: String(secret ?? ""),
    passphrase: passphrase ? String(passphrase) : undefined,
    paper: paper !== false,
    label: label ? String(label) : undefined,
  });
  if (!r.success) {
    res.status(400).json({ ok: false, error: r.error, code: "VALIDATION_FAILED" });
    return;
  }
  // Hot-load into bot if this is the active exchange
  if (exchangeService.getActiveExchange() === exchange) {
    bot.setOwnerUserId(userId);
    await bot.reloadActiveExchangeKeys();
  }
  const summary = await exchangeService.summariseCreds(
    exchange as exchangeService.ExchangeId,
    userId,
  );
  res.json({ ok: true, data: summary });
});

router.delete("/exchanges/:exchange/keys", async (req: Request, res: Response) => {
  const userId = uid(req);
  const ex = String(req.params["exchange"] ?? "").toLowerCase();
  if (!exchangeService.isSupported(ex)) {
    res.status(400).json({ ok: false, error: `Unsupported exchange: ${ex}`, code: "BAD_EXCHANGE" });
    return;
  }
  const r = await apiKeyService.deleteApiKeys(userId, ex as exchangeService.ExchangeId);
  res.json({ ok: r.ok, data: { deleted: r.deleted } });
});

router.get("/exchanges/balance", async (req: Request, res: Response) => {
  const userId = uid(req);
  const id = (req.query["exchange"] as string) || exchangeService.getActiveExchange();
  if (!exchangeService.isSupported(id)) {
    res.status(400).json({ ok: false, error: `Unsupported exchange: ${id}`, code: "BAD_EXCHANGE" });
    return;
  }
  // Decrypted keys live only inside this short-lived call path.
  const creds = await apiKeyService.getDecryptedKeys(userId, id);
  if (!creds) {
    res
      .status(404)
      .json({ ok: false, error: "No keys stored for this exchange", code: "NO_KEYS" });
    return;
  }
  const r = await exchangeService.fetchBalance(id);
  if (!r.success) {
    res.status(400).json({ ok: false, error: r.error, code: "BALANCE_FAILED" });
    return;
  }
  res.json({ ok: true, data: { exchange: id, totalUsd: r.totalUsd, balances: r.total } });
});

export default router;
