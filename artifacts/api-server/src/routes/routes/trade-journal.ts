import { Router, type Request, type Response } from "express";
import { tradeJournal, type JournalSearchParams } from "../../lib/tradeJournal";

const router = Router();

router.get("/trade-journal", (req: Request, res: Response) => {
  try {
    const params: JournalSearchParams = {
      strategyId: req.query["strategyId"] as string | undefined,
      regime:     req.query["regime"]     as string | undefined,
      status:     req.query["status"]     as JournalSearchParams["status"],
      symbol:     req.query["symbol"]     as string | undefined,
      tag:        req.query["tag"]        as string | undefined,
      from:       req.query["from"]       as string | undefined,
      to:         req.query["to"]         as string | undefined,
      limit:      req.query["limit"]  ? Number(req.query["limit"])  : 50,
      offset:     req.query["offset"] ? Number(req.query["offset"]) : 0,
      minPnl:     req.query["minPnl"] != null ? Number(req.query["minPnl"]) : undefined,
      maxPnl:     req.query["maxPnl"] != null ? Number(req.query["maxPnl"]) : undefined,
    };
    const entries = tradeJournal.search(params);
    res.json({ ok: true, data: entries, total: tradeJournal.getAll().length });
  } catch (err) {
    req.log.error({ err }, "trade-journal: search failed");
    res.status(500).json({ ok: false, error: "Failed to search journal" });
  }
});

router.get("/trade-journal/stats", (_req: Request, res: Response) => {
  res.json({ ok: true, data: tradeJournal.getStats() });
});

router.get("/trade-journal/:id", (req: Request, res: Response) => {
  const entry = tradeJournal.getById(String(req.params["id"] ?? ""));
  if (!entry) return res.status(404).json({ ok: false, error: "Entry not found" });
  return res.json({ ok: true, data: entry });
});

router.post("/trade-journal", (req: Request, res: Response) => {
  try {
    const data = req.body as Parameters<typeof tradeJournal.create>[0];
    if (!data.tradeId || !data.symbol) {
      return res.status(400).json({ ok: false, error: "tradeId and symbol required" });
    }
    const entry = tradeJournal.create(data);
    return res.status(201).json({ ok: true, data: entry });
  } catch (err) {
    req.log.error({ err }, "trade-journal: create failed");
    return res.status(500).json({ ok: false, error: "Failed to create entry" });
  }
});

router.patch("/trade-journal/:id", (req: Request, res: Response) => {
  try {
    const updated = tradeJournal.update(String(req.params["id"] ?? ""), req.body as Partial<Parameters<typeof tradeJournal.create>[0]>);
    if (!updated) return res.status(404).json({ ok: false, error: "Entry not found" });
    return res.json({ ok: true, data: updated });
  } catch (err) {
    req.log.error({ err }, "trade-journal: update failed");
    return res.status(500).json({ ok: false, error: "Failed to update entry" });
  }
});

router.delete("/trade-journal/:id", (req: Request, res: Response) => {
  const deleted = tradeJournal.delete(String(req.params["id"] ?? ""));
  if (!deleted) return res.status(404).json({ ok: false, error: "Entry not found" });
  return res.json({ ok: true, message: "Deleted" });
});

router.post("/trade-journal/close/:tradeId", (req: Request, res: Response) => {
  try {
    const data = req.body as Parameters<typeof tradeJournal.closeEntry>[1];
    tradeJournal.closeEntry(String(req.params["tradeId"] ?? ""), data);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "trade-journal: close failed");
    res.status(500).json({ ok: false, error: "Failed to close entry" });
  }
});

export default router;
