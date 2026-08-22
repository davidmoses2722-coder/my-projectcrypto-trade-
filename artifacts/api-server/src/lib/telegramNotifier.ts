import { logger } from "./logger";

// ─── Event Types ──────────────────────────────────────────────────────────────

export type TgEventType =
  | "TRADE_OPENED"
  | "TRADE_CLOSED_TP"
  | "TRADE_CLOSED_SL"
  | "TRADE_CLOSED_MANUAL"
  | "TRADE_CLOSED_RISK"
  | "TRADE_CLOSED"
  | "SCAN_BUY_SIGNAL"
  | "SCAN_BUY_ENQUEUED"
  | "SCAN_BUY_BLOCKED_PORTFOLIO"
  | "SCAN_BUY_BLOCKED_RISK"
  | "RISK_WARNING"
  | "RISK_COOLDOWN"
  | "RISK_HALTED"
  | "RISK_EMERGENCY"
  | "RISK_VOL_BLOCKED"
  | "RISK_VOL_CLEARED"
  | "PORTFOLIO_HIGH_EXPOSURE"
  | "PORTFOLIO_LIMIT_REACHED"
  | "DAILY_SUMMARY"
  | "TEST"
  // ── Phase 11: Position Lifecycle events ──────────────────────────────────
  | "TRAILING_ACTIVATED"
  | "BREAKEVEN_ACTIVATED"
  | "PROFIT_LOCKED"
  | "TIME_EXIT"
  | "MOMENTUM_EXIT"
  // ── Phase 11.1: Manual Position Controls ─────────────────────────────────
  | "MANUAL_TAKE_PROFIT"
  | "MANUAL_CLOSE";

export type EventData = Record<string, unknown>;

// ─── Rate limiting & dedup constants ─────────────────────────────────────────

// Per-event dedup cooldown (ms). 0 = no dedup (every occurrence is unique).
const DEDUP_COOLDOWNS: Partial<Record<TgEventType, number>> = {
  SCAN_BUY_SIGNAL:             60_000,   // 1 min per symbol
  SCAN_BUY_BLOCKED_PORTFOLIO: 300_000,   // 5 min
  SCAN_BUY_BLOCKED_RISK:      300_000,   // 5 min
  RISK_WARNING:               600_000,   // 10 min
  RISK_VOL_BLOCKED:           300_000,   // 5 min
  PORTFOLIO_HIGH_EXPOSURE:    600_000,   // 10 min
  PORTFOLIO_LIMIT_REACHED:    300_000,   // 5 min
};

// Token bucket: max 20 msgs/min (refill 1 token every 3 s)
const BUCKET_MAX        = 20;
const BUCKET_REFILL_MS  = 3_000;
const MAX_QUEUE_SIZE    = 50;
const MAX_RETRIES       = 3;
const RETRY_BASE_MS     = 1_000;

// ─── Internal state ───────────────────────────────────────────────────────────

interface QueueItem {
  text:    string;
  retries: number;
}

interface State {
  token:       string;
  chatId:      string;
  enabled:     boolean;
  bucket:      number;
  queue:       QueueItem[];
  processing:  boolean;
  lastSentAt:  number | null;
  lastMsg:     string | null;
  lastError:   string | null;
  totalSent:   number;
  totalFailed: number;
  dedupMap:    Map<string, number>;
}

const st: State = {
  token:       process.env["TELEGRAM_BOT_TOKEN"] ?? "",
  chatId:      process.env["TELEGRAM_CHAT_ID"]   ?? "",
  enabled:     true,
  bucket:      BUCKET_MAX,
  queue:       [],
  processing:  false,
  lastSentAt:  null,
  lastMsg:     null,
  lastError:   null,
  totalSent:   0,
  totalFailed: 0,
  dedupMap:    new Map(),
};

// ─── Token-bucket refiller + queue drainer ────────────────────────────────────

setInterval(() => {
  if (st.bucket < BUCKET_MAX) st.bucket = Math.min(BUCKET_MAX, st.bucket + 1);
  if (st.queue.length > 0 && !st.processing) void drainQueue();
}, BUCKET_REFILL_MS);

// ─── Dedup helpers ────────────────────────────────────────────────────────────

function dedupKey(event: TgEventType, tag?: string): string {
  return tag ? `${event}:${tag}` : event;
}

function isDeduped(event: TgEventType, tag?: string): boolean {
  const cooldown = DEDUP_COOLDOWNS[event] ?? 0;
  if (cooldown === 0) return false;
  const last = st.dedupMap.get(dedupKey(event, tag)) ?? 0;
  return Date.now() - last < cooldown;
}

function stampDedup(event: TgEventType, tag?: string): void {
  if ((DEDUP_COOLDOWNS[event] ?? 0) > 0) {
    st.dedupMap.set(dedupKey(event, tag), Date.now());
  }
}

// ─── Low-level HTTP send (single attempt, 8 s timeout) ───────────────────────

async function httpSend(text: string): Promise<{ ok: boolean; error?: string }> {
  const { token, chatId } = st;
  if (!token || !chatId) return { ok: false, error: "Telegram not configured" };
  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 8_000);
    const res  = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
        signal:  ctrl.signal,
      },
    );
    clearTimeout(tid);
    const j = (await res.json()) as { ok: boolean; description?: string };
    if (!j.ok) return { ok: false, error: j.description ?? `HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ─── Queue drain (token-bucket controlled, retries with back-off) ─────────────

async function drainQueue(): Promise<void> {
  if (st.processing) return;
  st.processing = true;
  try {
    while (st.queue.length > 0) {
      if (st.bucket <= 0) break;   // wait for next refill tick
      const item = st.queue[0]!;
      st.bucket--;

      let result: { ok: boolean; error?: string } = { ok: false, error: "max retries exceeded" };
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
          await new Promise<void>(r => setTimeout(r, RETRY_BASE_MS * (2 ** (attempt - 1))));
        }
        result = await httpSend(item.text);
        if (result.ok) break;
      }
      st.queue.shift();

      if (result.ok) {
        st.lastSentAt = Date.now();
        st.lastMsg    = item.text.slice(0, 120);
        st.totalSent++;
        logger.info("[Telegram] message sent");
      } else {
        st.lastError  = result.error ?? "unknown";
        st.totalFailed++;
        logger.warn({ err: result.error }, "[Telegram] delivery failed");
      }
    }
  } finally {
    st.processing = false;
  }
}

// ─── Enqueue helper ───────────────────────────────────────────────────────────

function enqueue(text: string): void {
  // ─── TRACE ────────────────────────────────────────────────────────────────
  logger.warn(
    { stack: new Error("[TRACE] enqueue() called").stack, textPreview: text.slice(0, 120) },
    `[TRACE][${new Date().toISOString()}] enqueue() | telegramNotifier.ts:177 | queueLen=${st.queue.length} enabled=${st.enabled} hasToken=${!!st.token} hasChatId=${!!st.chatId}`,
  );
  // ─────────────────────────────────────────────────────────────────────────
  if (!st.enabled)              return;
  if (!st.token || !st.chatId) return;
  if (st.queue.length >= MAX_QUEUE_SIZE) {
    logger.warn("[Telegram] queue full — message dropped");
    return;
  }
  st.queue.push({ text, retries: 0 });
  if (!st.processing) void drainQueue();
}

// ─── Message formatters ───────────────────────────────────────────────────────

function num(v: unknown, decimals?: number): string {
  const n = Number(v);
  if (isNaN(n)) return "?";
  if (decimals !== undefined) return n.toFixed(decimals);
  return n % 1 === 0 ? n.toFixed(0) : n.toFixed(n < 1 ? 4 : 2);
}

function mode(d: EventData): string {
  return d["isPaper"] ? "📄 <i>Paper Trade</i>\n" : "⚡ <i>Live Trade</i>\n";
}

function ts(): string {
  return `<i>${new Date().toUTCString()}</i>`;
}

function formatEvent(event: TgEventType, data: EventData): string {
  switch (event) {
    case "TRADE_OPENED": {
      const entry  = Number(data["entryPrice"] ?? 0);
      const tp     = Number(data["tpPrice"]    ?? 0);
      const sl     = Number(data["slPrice"]    ?? 0);
      const size   = Number(data["sizeUsdt"]   ?? 0);
      const slPct  = entry > 0 ? ((entry - sl) / entry) * 100 : 0;
      const tpPct  = entry > 0 ? ((tp - entry) / entry) * 100 : 0;
      const risk   = size > 0 && slPct > 0 ? (size * slPct / 100) : null;
      const strat  = data["strategy"] ? String(data["strategy"]) : null;
      return (
        `🚀 <b>BUY OPENED</b>\n\n` +
        `Symbol: <code>${data["symbol"] ?? "?"}</code>\n` +
        (strat ? `Strategy: <b>${strat}</b>\n` : `Strategy: <b>Active Swing (4h)</b>\n`) +
        `\nEntry:       <b>$${num(entry)}</b>\n` +
        `Stop Loss:  $${num(sl)} <i>(-${num(slPct, 2)}%)</i>\n` +
        `Take Profit: $${num(tp)} <i>(+${num(tpPct, 2)}%)</i>\n` +
        `\nPosition: <b>$${num(size)} USDT</b>\n` +
        (risk != null ? `Risk:     <b>$${num(risk, 2)} USDT</b> <i>(1% rule)</i>\n` : "") +
        `\n` + mode(data) + ts()
      );
    }
    case "TRADE_CLOSED_TP": {
      const pnlU  = Number(data["pnlUsd"] ?? 0);
      const pnlP  = Number(data["pnlPct"] ?? 0);
      const hold  = data["holdMins"] != null ? Number(data["holdMins"]) : null;
      const bal   = data["balance"]  != null ? Number(data["balance"])  : null;
      const hStr  = hold != null && hold > 0
        ? hold < 60 ? `${Math.round(hold)}m` : `${(hold / 60).toFixed(1)}h`
        : null;
      return (
        `✅ <b>TAKE PROFIT HIT</b>\n\n` +
        `Symbol: <code>${data["symbol"] ?? "?"}</code>\n` +
        `Exit:   <b>$${num(data["exitPrice"])}</b>\n` +
        `P&L:    <b>+$${num(pnlU)} (+${num(pnlP, 2)}%)</b>\n` +
        (hStr  ? `Hold:   <b>${hStr}</b>\n` : "") +
        (bal   != null ? `Balance: <b>$${num(bal)}</b>\n` : "") +
        `\n` + mode(data) + ts()
      );
    }
    case "TRADE_CLOSED_SL": {
      const pnlU  = Number(data["pnlUsd"] ?? 0);
      const pnlP  = Number(data["pnlPct"] ?? 0);
      const hold  = data["holdMins"] != null ? Number(data["holdMins"]) : null;
      const bal   = data["balance"]  != null ? Number(data["balance"])  : null;
      const hStr  = hold != null && hold > 0
        ? hold < 60 ? `${Math.round(hold)}m` : `${(hold / 60).toFixed(1)}h`
        : null;
      return (
        `🛑 <b>STOP LOSS HIT</b>\n\n` +
        `Symbol: <code>${data["symbol"] ?? "?"}</code>\n` +
        `Exit:   <b>$${num(data["exitPrice"])}</b>\n` +
        `P&L:    <b>$${num(pnlU)} (${num(pnlP, 2)}%)</b>\n` +
        (hStr  ? `Hold:   <b>${hStr}</b>\n` : "") +
        (bal   != null ? `Balance: <b>$${num(bal)}</b>\n` : "") +
        `\n` + mode(data) + ts()
      );
    }
    case "TRADE_CLOSED_MANUAL":
      return (
        `🔵 <b>MANUAL CLOSE</b>\n\n` +
        `Symbol: <code>${data["symbol"] ?? "?"}</code>\n` +
        `Exit: <b>$${num(data["exitPrice"])}</b>\n` +
        `P&L: <b>$${num(data["pnlUsd"])} (${num(data["pnlPct"], 2)}%)</b>\n` +
        (data["balance"] != null ? `Balance: <b>$${num(data["balance"])}</b>\n` : "") +
        `\n` + mode(data) + ts()
      );
    case "TRADE_CLOSED_RISK":
      return (
        `⚠️ <b>RISK HALT CLOSE</b>\n\n` +
        `Symbol: <code>${data["symbol"] ?? "?"}</code>\n` +
        `Exit: <b>$${num(data["exitPrice"])}</b>\n` +
        `P&L: <b>$${num(data["pnlUsd"])} (${num(data["pnlPct"], 2)}%)</b>\n` +
        `Reason: ${data["reason"] ?? "risk limit"}\n` +
        (data["balance"] != null ? `Balance: <b>$${num(data["balance"])}</b>\n` : "") +
        `\n` + mode(data) + ts()
      );
    case "TRADE_CLOSED": {
      const pnlU = Number(data["pnlUsd"] ?? 0);
      return (
        `${pnlU >= 0 ? "🟢" : "🔴"} <b>POSITION CLOSED</b>\n\n` +
        `Symbol: <code>${data["symbol"] ?? "?"}</code>\n` +
        `Exit: <b>$${num(data["exitPrice"])}</b>\n` +
        `P&L: <b>$${num(pnlU)} (${num(data["pnlPct"], 2)}%)</b>\n` +
        `Reason: ${data["reason"] ?? "unknown"}\n` +
        (data["balance"] != null ? `Balance: <b>$${num(data["balance"])}</b>\n` : "") +
        `\n` + mode(data) + ts()
      );
    }
    case "SCAN_BUY_SIGNAL":
      return (
        `🔍 <b>BUY Signal Detected</b>\n` +
        `Symbol: <code>${data["symbol"] ?? "?"}</code>\n` +
        `Price: ${num(data["price"])} | Confidence: ${num(data["confidence"])}%\n` +
        ts()
      );
    case "SCAN_BUY_ENQUEUED":
      return (
        `📥 <b>BUY Signal Enqueued</b>\n` +
        `Symbol: <code>${data["symbol"] ?? "?"}</code> @ ${num(data["price"])}\n` +
        `Size: $${num(data["sizeUsdt"])}\n` +
        ts()
      );
    case "SCAN_BUY_BLOCKED_PORTFOLIO":
      return (
        `🚫 <b>BUY Blocked — Portfolio</b>\n` +
        `Symbol: <code>${data["symbol"] ?? "?"}</code>\n` +
        `${data["reason"] ?? "portfolio limit reached"}\n` +
        ts()
      );
    case "SCAN_BUY_BLOCKED_RISK":
      return (
        `🚫 <b>BUY Blocked — Risk Engine</b>\n` +
        `Symbol: <code>${data["symbol"] ?? "?"}</code>\n` +
        `${data["reason"] ?? "risk limit active"}\n` +
        ts()
      );
    case "RISK_WARNING":
      return (
        `⚠️ <b>Risk Warning</b>\n` +
        `${data["warnings"] ?? "Risk threshold approaching"}\n` +
        ts()
      );
    case "RISK_COOLDOWN":
      return (
        `❄️ <b>Risk Cooldown Activated</b>\n` +
        `Reason: ${data["reason"] ?? "consecutive losses"}\n` +
        `Duration: ${data["durationSec"] ?? "?"}s\n` +
        ts()
      );
    case "RISK_HALTED":
      return (
        `🚨 <b>Trading HALTED</b>\n` +
        `Reason: ${data["reason"] ?? "risk limit reached"}\n` +
        ts()
      );
    case "RISK_VOL_BLOCKED":
      return (
        `📈 <b>Volatility Block Activated</b>\n` +
        `Current ATR: ${data["currentAtrPct"] ?? "?"}%\n` +
        `Average ATR: ${data["avgAtrPct"] ?? "?"}%\n` +
        `Threshold:   ${data["thresholdPct"] ?? "?"}% (${data["multiplier"] ?? 3}× avg)\n` +
        `Price: $${data["price"] ?? "?"} | Raw ATR: ${data["atrRaw"] ?? "?"}\n` +
        ts()
      );
    case "RISK_VOL_CLEARED":
      return (
        `📉 <b>Volatility Block Cleared</b>\n` +
        `ATR normalised — trading resumed\n` +
        (data["currentAtrPct"] ? `Current ATR: ${data["currentAtrPct"]}% | Avg: ${data["avgAtrPct"]}%\n` : "") +
        ts()
      );
    case "PORTFOLIO_HIGH_EXPOSURE":
      return (
        `💰 <b>High Portfolio Exposure</b>\n` +
        `Exposure: $${num(data["exposureUsdt"])} / $${num(data["maxUsdt"])} (${num(data["pct"])}%)\n` +
        ts()
      );
    case "PORTFOLIO_LIMIT_REACHED":
      return (
        `🔒 <b>Position Limit Reached</b>\n` +
        `${data["reason"] ?? "max positions open"}\n` +
        ts()
      );
    case "DAILY_SUMMARY": {
      const d   = new Date();
      const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
      const pnl = Number(data["dailyPnl"]);
      const w7  = Number(data["weekly7dPnl"] ?? 0);
      const m30 = Number(data["monthly30dPnl"] ?? 0);
      const pf  = data["profitFactor"]   != null ? `${data["profitFactor"]}` : "—";
      const dd  = data["maxDrawdownPct"] != null ? `${data["maxDrawdownPct"]}%` : "—";
      const roi = data["sessionRoiPct"]  != null ? `${Number(data["sessionRoiPct"]) >= 0 ? "+" : ""}${data["sessionRoiPct"]}%` : "—";
      return (
        `📊 <b>Daily Report — ${day}</b>\n\n` +
        `Trades: ${data["totalTrades"] ?? 0} | Wins: ${data["wins"] ?? 0} | Losses: ${data["losses"] ?? 0}\n` +
        `Win Rate: <b>${data["winRate"] ?? "0"}%</b> | Profit Factor: <b>${pf}</b>\n\n` +
        `Daily P&L:   <b>${pnl >= 0 ? "+" : ""}$${num(data["dailyPnl"])}</b>\n` +
        `7-Day P&L:   <b>${w7  >= 0 ? "+" : ""}$${w7.toFixed(2)}</b>\n` +
        `30-Day P&L:  <b>${m30 >= 0 ? "+" : ""}$${m30.toFixed(2)}</b>\n` +
        `Session ROI: <b>${roi}</b>\n\n` +
        `Max Drawdown: ${dd}\n` +
        `Open Positions: ${data["openPositions"] ?? 0}\n` +
        `Balance: $${num(data["balance"])}\n` +
        ts()
      );
    }
    case "TRAILING_ACTIVATED": {
      const entry   = Number(data["entryPrice"]   ?? 0);
      const current = Number(data["currentPrice"] ?? 0);
      const newSl   = Number(data["newSl"]        ?? 0);
      const atr     = Number(data["atr"]          ?? 0);
      const pnlUsd  = Number(data["profitUsd"]    ?? 0);
      const pnlPct  = Number(data["profitPct"]    ?? 0);
      const dur     = data["durationMs"] != null ? Number(data["durationMs"]) : null;
      const durStr  = dur != null ? (dur < 60000 ? `${Math.round(dur / 1000)}s` : `${Math.round(dur / 60000)}m`) : null;
      return (
        `📏 <b>TRAILING STOP ACTIVATED</b>\n\n` +
        `Symbol: <code>${data["symbol"] ?? "?"}</code>\n` +
        `Entry:   <b>${num(entry)}</b>\n` +
        `Current: <b>${num(current)}</b>\n` +
        `New SL:  <b>${num(newSl)}</b> <i>(ATR×2 = ${num(atr, 4)})</i>\n` +
        `P&L:     <b>${pnlUsd >= 0 ? "+" : ""}${num(pnlUsd)} (${num(pnlPct, 2)}%)</b>\n` +
        (durStr ? `Duration: ${durStr}\n` : "") +
        `\n` + mode(data) + ts()
      );
    }
    case "BREAKEVEN_ACTIVATED": {
      const entry   = Number(data["entryPrice"]   ?? 0);
      const current = Number(data["currentPrice"] ?? 0);
      const pnlUsd  = Number(data["profitUsd"]    ?? 0);
      const pnlPct  = Number(data["profitPct"]    ?? 0);
      const dur     = data["durationMs"] != null ? Number(data["durationMs"]) : null;
      const durStr  = dur != null ? (dur < 60000 ? `${Math.round(dur / 1000)}s` : `${Math.round(dur / 60000)}m`) : null;
      return (
        `🔒 <b>BREAKEVEN STOP ACTIVATED</b>\n\n` +
        `Symbol: <code>${data["symbol"] ?? "?"}</code>\n` +
        `Entry:      <b>${num(entry)}</b>\n` +
        `Current:    <b>${num(current)}</b>\n` +
        `SL moved to: <b>${num(entry)}</b> <i>(breakeven — 1R reached)</i>\n` +
        `Current P&L: <b>+${num(pnlUsd)} (+${num(pnlPct, 2)}%)</b>\n` +
        (durStr ? `Duration: ${durStr}\n` : "") +
        `\n` + mode(data) + ts()
      );
    }
    case "PROFIT_LOCKED": {
      const tierPct  = Number(data["tierPct"]      ?? 0);
      const newSl    = Number(data["newSl"]        ?? 0);
      const lockedUsd = Number(data["lockedUsd"]   ?? 0);
      const current  = Number(data["currentPrice"] ?? 0);
      const pnlUsd   = Number(data["profitUsd"]    ?? 0);
      const pnlPct   = Number(data["profitPct"]    ?? 0);
      return (
        `💎 <b>PROFIT LOCKED — ${tierPct}% TIER</b>\n\n` +
        `Symbol:  <code>${data["symbol"] ?? "?"}</code>\n` +
        `Current: <b>${num(current)}</b>\n` +
        `New SL:  <b>${num(newSl)}</b>\n` +
        `Locked:  <b>~${num(lockedUsd, 2)} min profit</b>\n` +
        `P&L now: <b>+${num(pnlUsd)} (+${num(pnlPct, 2)}%)</b>\n` +
        `\n` + mode(data) + ts()
      );
    }
    case "TIME_EXIT": {
      const current   = Number(data["currentPrice"] ?? 0);
      const pnlUsd    = Number(data["profitUsd"]    ?? 0);
      const pnlPct    = Number(data["profitPct"]    ?? 0);
      const durMs     = Number(data["durationMs"]   ?? 0);
      const limitMs   = Number(data["limitMs"]      ?? 0);
      const strategy  = data["strategyType"] ? String(data["strategyType"]) : null;
      const fmtMs = (ms: number) => {
        const s = ms / 1000;
        if (s < 60) return `${Math.floor(s)}s`;
        if (s < 3600) return `${Math.floor(s / 60)}m`;
        return `${Math.floor(s / 3600)}h`;
      };
      return (
        `⏰ <b>TIME EXIT TRIGGERED</b>\n\n` +
        `Symbol:   <code>${data["symbol"] ?? "?"}</code>\n` +
        `Current:  <b>${num(current)}</b>\n` +
        `Duration: <b>${fmtMs(durMs)}</b> <i>(limit: ${fmtMs(limitMs)})</i>\n` +
        (strategy ? `Strategy: ${strategy}\n` : "") +
        `P&L:      <b>${pnlUsd >= 0 ? "+" : ""}${num(pnlUsd)} (${num(pnlPct, 2)}%)</b>\n` +
        `\n` + mode(data) + ts()
      );
    }
    case "MANUAL_TAKE_PROFIT": {
      const entry   = Number(data["entryPrice"] ?? 0);
      const exit_   = Number(data["exitPrice"]  ?? 0);
      const pnlU    = Number(data["pnlUsd"]     ?? 0);
      const pnlP    = Number(data["pnlPct"]     ?? 0);
      const holdMs  = data["holdMs"] != null ? Number(data["holdMs"]) : null;
      const fmtMs   = (ms: number) => {
        const s = ms / 1000;
        if (s < 60) return `${Math.round(s)}s`;
        if (s < 3600) return `${Math.round(s / 60)}m`;
        return `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`;
      };
      return (
        `🟢 <b>MANUAL TAKE PROFIT</b>\n\n` +
        `Symbol:  <code>${data["symbol"] ?? "?"}</code>\n` +
        `Entry:   <b>${num(entry)}</b>\n` +
        `Exit:    <b>${num(exit_)}</b>\n` +
        `P&L:     <b>${pnlU >= 0 ? "+" : ""}${num(pnlU)} (${pnlU >= 0 ? "+" : ""}${num(pnlP, 2)}%)</b>\n` +
        (holdMs != null ? `Duration: <b>${fmtMs(holdMs)}</b>\n` : "") +
        `Reason:  Manual Take Profit\n` +
        `\n` + mode(data) + ts()
      );
    }
    case "MANUAL_CLOSE": {
      const entry   = Number(data["entryPrice"] ?? 0);
      const exit_   = Number(data["exitPrice"]  ?? 0);
      const pnlU    = Number(data["pnlUsd"]     ?? 0);
      const pnlP    = Number(data["pnlPct"]     ?? 0);
      const holdMs  = data["holdMs"] != null ? Number(data["holdMs"]) : null;
      const fmtMs   = (ms: number) => {
        const s = ms / 1000;
        if (s < 60) return `${Math.round(s)}s`;
        if (s < 3600) return `${Math.round(s / 60)}m`;
        return `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`;
      };
      return (
        `🔴 <b>MANUAL CLOSE</b>\n\n` +
        `Symbol:  <code>${data["symbol"] ?? "?"}</code>\n` +
        `Entry:   <b>${num(entry)}</b>\n` +
        `Exit:    <b>${num(exit_)}</b>\n` +
        `P&L:     <b>${pnlU >= 0 ? "+" : ""}${num(pnlU)} (${pnlU >= 0 ? "+" : ""}${num(pnlP, 2)}%)</b>\n` +
        (holdMs != null ? `Duration: <b>${fmtMs(holdMs)}</b>\n` : "") +
        `Reason:  Manual Close\n` +
        `\n` + mode(data) + ts()
      );
    }
    case "MOMENTUM_EXIT": {
      const current  = Number(data["currentPrice"] ?? 0);
      const pnlUsd   = Number(data["profitUsd"]    ?? 0);
      const pnlPct   = Number(data["profitPct"]    ?? 0);
      const reasons  = data["reasons"] ? String(data["reasons"]) : "multiple signals";
      const durMs    = Number(data["durationMs"]   ?? 0);
      const fmtMs    = (ms: number) => {
        const s = ms / 1000;
        if (s < 60) return `${Math.floor(s)}s`;
        if (s < 3600) return `${Math.floor(s / 60)}m`;
        return `${Math.floor(s / 3600)}h`;
      };
      return (
        `📉 <b>MOMENTUM EXIT TRIGGERED</b>\n\n` +
        `Symbol:   <code>${data["symbol"] ?? "?"}</code>\n` +
        `Current:  <b>${num(current)}</b>\n` +
        `Duration: <b>${fmtMs(durMs)}</b>\n` +
        `Signals:  <i>${reasons}</i>\n` +
        `P&L:      <b>${pnlUsd >= 0 ? "+" : ""}${num(pnlUsd)} (${num(pnlPct, 2)}%)</b>\n` +
        `\n` + mode(data) + ts()
      );
    }
    case "TEST":
      return (
        `✅ <b>Pro Crypto Bot — Test Message</b>\n` +
        `Telegram notifications are working correctly.\n` +
        ts()
      );
    default:
      return `📢 <b>${event as string}</b>\n${JSON.stringify(data)}\n${ts()}`;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Update runtime credentials (called from bot.setConfig). */
export function updateConfig(token: string, chatId: string): void {
  st.token  = token;
  st.chatId = chatId;
}

/** Enable / disable all outbound notifications. */
export function setEnabled(enabled: boolean): void {
  st.enabled = enabled;
}

export function isEnabled(): boolean {
  return st.enabled;
}

/**
 * Emit a structured event notification.
 * Dedup is applied per event+tag; trade events have no cooldown (each is unique).
 * @param tag  Optional sub-key for dedup (e.g. symbol for scanner events).
 */
export function notify(event: TgEventType, data: EventData = {}, tag?: string): void {
  if (isDeduped(event, tag)) return;
  stampDedup(event, tag);
  enqueue(formatEvent(event, data));
}

/**
 * Direct text send — bypasses queue and dedup.
 * Used by bot.sendTelegram shim so existing route still works.
 */
export async function send(text: string): Promise<{ ok: boolean; error?: string }> {
  // ─── TRACE ────────────────────────────────────────────────────────────────
  logger.warn(
    { stack: new Error("[TRACE] send() called").stack, textPreview: text.slice(0, 120) },
    `[TRACE][${new Date().toISOString()}] send() | telegramNotifier.ts:436 | hasToken=${!!st.token} hasChatId=${!!st.chatId} enabled=${st.enabled}`,
  );
  // ─────────────────────────────────────────────────────────────────────────
  if (!st.token || !st.chatId) return { ok: false, error: "Telegram not configured" };
  if (!st.enabled)              return { ok: false, error: "Telegram notifications disabled" };
  const result = await httpSend(text);
  if (result.ok) {
    st.lastSentAt = Date.now();
    st.lastMsg    = text.slice(0, 120);
    st.totalSent++;
    logger.info("[Telegram] message sent");
  } else {
    st.lastError  = result.error ?? "unknown";
    st.totalFailed++;
    logger.warn({ err: result.error }, "[Telegram] delivery failed");
  }
  return result;
}

/** Status snapshot for the /api/telegram/status endpoint. */
export function getStatus() {
  return {
    configured:  !!(st.token && st.chatId),
    enabled:     st.enabled,
    chatId:      st.chatId ? `...${st.chatId.slice(-6)}` : null,
    lastSentAt:  st.lastSentAt,
    lastMsg:     st.lastMsg,
    lastError:   st.lastError,
    queueLen:    st.queue.length,
    totalSent:   st.totalSent,
    totalFailed: st.totalFailed,
  };
}

// ─── Photo send ───────────────────────────────────────────────────────────────

/**
 * Send a photo (by public URL) with an optional HTML caption.
 * Falls back to a plain text message when the image URL is unavailable.
 */
export async function sendPhoto(
  imageUrl: string,
  caption: string,
): Promise<{ ok: boolean; error?: string }> {
  // ─── TRACE ────────────────────────────────────────────────────────────────
  logger.warn(
    { stack: new Error("[TRACE] sendPhoto() called").stack, imageUrl, captionPreview: caption.slice(0, 80) },
    `[TRACE][${new Date().toISOString()}] sendPhoto() | telegramNotifier.ts | hasToken=${!!st.token} hasChatId=${!!st.chatId}`,
  );
  // ─────────────────────────────────────────────────────────────────────────
  const { token, chatId } = st;
  if (!token || !chatId) return { ok: false, error: "Telegram not configured" };
  if (!st.enabled)        return { ok: false, error: "Telegram notifications disabled" };
  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 12_000);
    const res  = await fetch(
      `https://api.telegram.org/bot${token}/sendPhoto`,
      {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          chat_id:    chatId,
          photo:      imageUrl,
          caption,
          parse_mode: "HTML",
        }),
        signal: ctrl.signal,
      },
    );
    clearTimeout(tid);
    const j = (await res.json()) as { ok: boolean; description?: string };
    if (!j.ok) return { ok: false, error: j.description ?? `HTTP ${res.status}` };
    st.lastSentAt = Date.now();
    st.totalSent++;
    logger.info("[Telegram] photo sent");
    return { ok: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    st.totalFailed++;
    st.lastError = error;
    logger.warn({ err: error }, "[Telegram] photo delivery failed");
    return { ok: false, error };
  }
}

/**
 * Schedule a daily summary at UTC midnight.
 * getData() is called lazily at send time so bot state is always current.
 * getChartUrl() is optional — when provided, a P&L chart image is sent
 * after the text summary. Falls back gracefully if chart generation fails.
 */
export function scheduleDailySummary(
  getData:      () => EventData,
  getChartUrl?: () => Promise<string | null>,
): void {
  // ─── TRACE ────────────────────────────────────────────────────────────────
  logger.warn(
    { stack: new Error("[TRACE] scheduleDailySummary() registered").stack },
    `[TRACE][${new Date().toISOString()}] scheduleDailySummary() REGISTERED | telegramNotifier.ts:520`,
  );
  // ─────────────────────────────────────────────────────────────────────────
  function msUntilMidnight(): number {
    const now = Date.now();
    const d   = new Date(now);
    const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
    return midnight - now;
  }

  const fireAndReschedule = (): void => {
    // ─── TRACE ──────────────────────────────────────────────────────────────
    logger.warn(
      { stack: new Error("[TRACE] scheduleDailySummary fireAndReschedule FIRED").stack },
      `[TRACE][${new Date().toISOString()}] scheduleDailySummary fireAndReschedule FIRED | telegramNotifier.ts`,
    );
    // ───────────────────────────────────────────────────────────────────────
    void (async () => {
      notify("DAILY_SUMMARY", getData());

      if (getChartUrl) {
        try {
          const url = await getChartUrl();
          if (url) {
            const d   = new Date();
            const day = d.toLocaleDateString("en-US", {
              weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
            });
            await sendPhoto(url, `📊 <b>P&amp;L Chart — ${day}</b>`);
          }
        } catch (err) {
          logger.warn({ err }, "[Telegram] daily chart send failed — skipping");
        }
      }
    })();

    setTimeout(fireAndReschedule, 24 * 60 * 60 * 1_000);
  };

  setTimeout(fireAndReschedule, msUntilMidnight());
}

/**
 * Schedule a weekly summary every Sunday at UTC midnight.
 */
export function scheduleWeeklySummary(getData: () => EventData): void {
  // ─── TRACE ────────────────────────────────────────────────────────────────
  logger.warn(
    { stack: new Error("[TRACE] scheduleWeeklySummary() registered").stack },
    `[TRACE][${new Date().toISOString()}] scheduleWeeklySummary() REGISTERED | telegramNotifier.ts:560`,
  );
  // ─────────────────────────────────────────────────────────────────────────
  function msUntilSunday(): number {
    const now  = Date.now();
    const d    = new Date(now);
    const daysUntilSunday = (7 - d.getUTCDay()) % 7 || 7;
    const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + daysUntilSunday);
    return next - now;
  }

  const fireAndReschedule = (): void => {
    // ─── TRACE ──────────────────────────────────────────────────────────────
    logger.warn(
      { stack: new Error("[TRACE] scheduleWeeklySummary fireAndReschedule FIRED").stack },
      `[TRACE][${new Date().toISOString()}] scheduleWeeklySummary fireAndReschedule FIRED | telegramNotifier.ts`,
    );
    // ───────────────────────────────────────────────────────────────────────
    void (async () => {
      const data     = getData();
      const d        = new Date();
      const week     = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
      const stratLine = data["activeStrategy"]
        ? `Strategy: <b>${String(data["activeStrategy"])}</b>\n`
        : "";
      enqueue(
        `📅 <b>Weekly Report — w/e ${week}</b>\n\n` +
        `${stratLine}` +
        `Trades: ${data["totalTrades"] ?? 0} | Wins: ${data["wins"] ?? 0} | Losses: ${data["losses"] ?? 0}\n` +
        `Win Rate: <b>${data["winRate"] ?? "0"}%</b> | Profit Factor: <b>${data["profitFactor"] ?? "—"}</b>\n` +
        `7-Day P&L: <b>${Number(data["weekly7dPnl"] ?? 0) >= 0 ? "+" : ""}$${Number(data["weekly7dPnl"] ?? 0).toFixed(2)}</b>\n` +
        `Max Drawdown: ${data["maxDrawdownPct"] ?? "—"}%\n` +
        `Balance: $${Number(data["balance"] ?? 0).toFixed(2)}\n` +
        `<i>${d.toUTCString()}</i>`
      );
      setTimeout(fireAndReschedule, 7 * 24 * 60 * 60 * 1_000);
    })();
  };

  setTimeout(fireAndReschedule, msUntilSunday());
}

// Node's setTimeout silently overflows for values > 2^31-1 ms (~24.8 days),
// clamping to 1 ms and creating an infinite tight loop. This helper chunks
// any delay that exceeds the safe limit into sequential shorter timeouts.
function safeTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
  const MAX_SAFE_MS = 2_100_000_000; // ~24 days, safely below 2^31-1
  if (ms <= MAX_SAFE_MS) return setTimeout(fn, ms);
  return setTimeout(() => safeTimeout(fn, ms - MAX_SAFE_MS), MAX_SAFE_MS);
}

// ─── Monthly scheduler guards ─────────────────────────────────────────────────

/** Prevents scheduleMonthlySummary from registering more than one scheduler. */
let monthlySummaryScheduled = false;

/**
 * Tracks the last calendar month (YYYY-MM) for which the monthly report was
 * sent. Prevents duplicate sends if the scheduler fires more than once within
 * the same month (e.g. due to a server restart near midnight on the 1st).
 */
let lastMonthlySentKey = "";

/**
 * Schedule a monthly summary on the 1st of each month at UTC midnight.
 * Guaranteed to send at most once per calendar month.
 */
export function scheduleMonthlySummary(getData: () => EventData): void {
  // ─── TRACE ────────────────────────────────────────────────────────────────
  logger.warn(
    { stack: new Error("[TRACE] scheduleMonthlySummary() called").stack, alreadyScheduled: monthlySummaryScheduled },
    `[TRACE][${new Date().toISOString()}] scheduleMonthlySummary() CALLED | telegramNotifier.ts:619 | alreadyScheduled=${monthlySummaryScheduled}`,
  );
  // ─────────────────────────────────────────────────────────────────────────
  // Guard 1: singleton — reject any second registration attempt.
  if (monthlySummaryScheduled) {
    logger.warn("[Telegram] scheduleMonthlySummary called more than once — ignoring duplicate registration");
    return;
  }
  monthlySummaryScheduled = true;

  function msUntilFirstOfMonth(): number {
    const now = Date.now();
    const d   = new Date(now);
    const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    return next - now;
  }

  const fireAndReschedule = (): void => {
    // ─── TRACE ──────────────────────────────────────────────────────────────
    logger.warn(
      { stack: new Error("[TRACE] scheduleMonthlySummary fireAndReschedule FIRED").stack },
      `[TRACE][${new Date().toISOString()}] scheduleMonthlySummary fireAndReschedule FIRED | telegramNotifier.ts | lastSentKey="${lastMonthlySentKey}"`,
    );
    // ───────────────────────────────────────────────────────────────────────
    void (async () => {
      const d        = new Date();
      // Guard 2: same-month dedup — build a YYYY-MM key for the current month.
      const monthKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      if (lastMonthlySentKey === monthKey) {
        logger.warn(`[Telegram] monthly report already sent for ${monthKey} — skipping duplicate`);
        safeTimeout(fireAndReschedule, msUntilFirstOfMonth());
        return;
      }
      lastMonthlySentKey = monthKey;

      const data      = getData();
      const month     = d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
      const stratLine = data["activeStrategy"]
        ? `Strategy: <b>${String(data["activeStrategy"])}</b>\n`
        : "";
      enqueue(
        `📆 <b>Monthly Report — ${month}</b>\n\n` +
        `${stratLine}` +
        `Trades: ${data["totalTrades"] ?? 0} | Wins: ${data["wins"] ?? 0} | Losses: ${data["losses"] ?? 0}\n` +
        `Win Rate: <b>${data["winRate"] ?? "0"}%</b> | Profit Factor: <b>${data["profitFactor"] ?? "—"}</b>\n` +
        `30-Day P&L: <b>${Number(data["monthly30dPnl"] ?? 0) >= 0 ? "+" : ""}${Number(data["monthly30dPnl"] ?? 0).toFixed(2)}</b>\n` +
        `Total P&L: <b>${Number(data["totalPnlUsd"] ?? 0) >= 0 ? "+" : ""}${Number(data["totalPnlUsd"] ?? 0).toFixed(2)}</b>\n` +
        `Session ROI: <b>${data["sessionRoiPct"] ?? "—"}%</b>\n` +
        `Max Drawdown: ${data["maxDrawdownPct"] ?? "—"}%\n` +
        `Balance: ${Number(data["balance"] ?? 0).toFixed(2)}\n` +
        `<i>${d.toUTCString()}</i>`
      );
      logger.info(`[Telegram] monthly report sent for ${monthKey}`);
      safeTimeout(fireAndReschedule, msUntilFirstOfMonth());
    })();
  };

  safeTimeout(fireAndReschedule, msUntilFirstOfMonth());
}
