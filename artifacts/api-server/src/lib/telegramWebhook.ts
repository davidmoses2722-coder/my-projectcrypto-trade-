/**
 * Telegram Control Center v2.0
 *
 * Transforms Telegram into a secure remote command center:
 * - Full info/control/market command set
 * - Admin whitelist (TELEGRAM_ADMIN_IDS env var)
 * - Confirmation flows for destructive actions
 * - Inline keyboard buttons
 * - Unauthorized attempt logging
 * - Weekly + monthly scheduled reports (wired from bot.ts)
 */

import { logger } from "./logger";
import {
  buildStatus, start, stop, getBotIsRunning, setConfig, getRiskState,
  resetPaperBalance, triggerScan, getBotActiveStrategy, getBotActiveEngine,
  getBotExchangeCreds, getBotOrderSizeUsdt,
} from "./bot";
import { ACTIVE_STRATEGY_IDS } from "../services/strategies/index";
import * as performanceTracker from "./performanceTracker";
import { getTradeCounters, getMonthlyProjection } from "../services/strategies/ActiveSwingStrategy";
import {
  getTradeCounters  as getCSCounters,
  getMonthlyProjection as getCSProjection,
  STRATEGY_PARAMS   as CS_PARAMS,
} from "../services/strategies/ConservativeScalpingStrategy";
import * as telegramNotifier   from "./telegramNotifier";
import { startBenchmark, getBenchmarkState } from "../services/benchmarkService";
import { runOpportunityScanner, getOpportunitiesForTelegram } from "../services/opportunityScanner";
import { getSignalAnalysis, type ManualStrategyId } from "../services/manualTradeService";
import { placeMarketOrder } from "../services/tradeService";
import { toGateApiSymbol, toDisplaySymbol, InvalidSymbolError } from "../shared/symbolUtils";

// ─── Telegram API types ───────────────────────────────────────────────────────

interface TgUser          { id: number; username?: string; first_name?: string }
interface TgChat          { id: number; type: string }
interface TgMsg           { message_id: number; from?: TgUser; chat: TgChat; text?: string; date: number }
interface TgCallbackQuery { id: string; from: TgUser; message?: TgMsg; data?: string }
interface TgUpdate        { update_id: number; message?: TgMsg; callback_query?: TgCallbackQuery }

// ─── Admin whitelist ──────────────────────────────────────────────────────────

function getAdminIds(): Set<number> {
  const raw = process.env["TELEGRAM_ADMIN_IDS"] ?? "";
  if (!raw.trim()) return new Set(); // empty = no restriction (backward compat)
  const ids = raw.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
  return new Set(ids);
}

function isAdmin(userId: number): boolean {
  const ids = getAdminIds();
  if (ids.size === 0) return true; // no list configured → allow all (same as before)
  return ids.has(userId);
}

// ─── Confirmation state ───────────────────────────────────────────────────────

interface PendingAction {
  action:    string;  // human label
  fn:        () => Promise<string>; // returns reply text
  expiresAt: number;
}
const pendingMap = new Map<number, PendingAction>(); // key = userId

function setPending(userId: number, action: string, fn: () => Promise<string>): void {
  pendingMap.set(userId, { action, fn, expiresAt: Date.now() + 60_000 });
}

function clearPending(userId: number): void {
  pendingMap.delete(userId);
}

// ─── Secret / webhook ────────────────────────────────────────────────────────

function makeSecret(token: string): string {
  return token.replace(/[^A-Za-z0-9_]/g, "").slice(0, 256);
}

export function getWebhookSecret(): string {
  return makeSecret(process.env["TELEGRAM_BOT_TOKEN"] ?? "");
}

export async function registerWebhook(): Promise<void> {
  const token  = process.env["TELEGRAM_BOT_TOKEN"];
  const domain = process.env["REPLIT_DEV_DOMAIN"];
  if (!token) { logger.info("telegramWebhook: no token — skipping"); return; }
  if (!domain) { logger.warn("telegramWebhook: REPLIT_DEV_DOMAIN not set"); return; }

  const webhookUrl  = `https://${domain}/api/telegram/webhook`;
  const secretToken = getWebhookSecret();
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        url:             webhookUrl,
        secret_token:    secretToken,
        allowed_updates: ["message", "callback_query"],
      }),
    });
    const j = (await res.json()) as { ok: boolean; description?: string };
    if (j.ok) logger.info({ webhookUrl }, "telegramWebhook: webhook registered");
    else       logger.warn({ err: j.description }, "telegramWebhook: setWebhook failed");
  } catch (err) {
    logger.warn({ err }, "telegramWebhook: registration failed");
  }
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function sendMsg(
  chatId:  number,
  text:    string,
  markup?: { inline_keyboard: { text: string; callback_data: string }[][] },
): Promise<void> {
  // ─── TRACE ────────────────────────────────────────────────────────────────
  logger.warn(
    { stack: new Error("[TRACE] telegramWebhook:sendMsg() called").stack, chatId, textPreview: text.slice(0, 120) },
    `[TRACE][${new Date().toISOString()}] telegramWebhook:sendMsg() | telegramWebhook.ts:112 | chatId=${chatId}`,
  );
  // ─────────────────────────────────────────────────────────────────────────
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  if (!token) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id:      chatId,
        text,
        parse_mode:   "HTML",
        reply_markup: markup,
      }),
    });
    const j = (await res.json()) as { ok: boolean; description?: string };
    if (j.ok) {
      logger.info({ chatId, textPreview: text.slice(0, 80) }, "[Telegram] telegramWebhook:sendMsg succeeded");
    } else {
      logger.warn({ chatId, err: j.description }, "[Telegram] telegramWebhook:sendMsg API error");
    }
  } catch (err) {
    logger.warn({ err }, "telegramWebhook: sendMsg failed");
  }
}

async function answerCallback(callbackId: string, text?: string): Promise<void> {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ callback_query_id: callbackId, text: text ?? "" }),
    });
  } catch { /* ignore */ }
}

// ─── Inline keyboard ──────────────────────────────────────────────────────────

const MAIN_KB = {
  inline_keyboard: [
    [
      { text: "▶️ Start Bot",      callback_data: "cb:startbot"   },
      { text: "⏹ Stop Bot",       callback_data: "cb:stopbot"    },
    ],
    [
      { text: "📊 Status",         callback_data: "cb:status"     },
      { text: "💰 Balance",        callback_data: "cb:balance"    },
    ],
    [
      { text: "📍 Positions",      callback_data: "cb:positions"  },
      { text: "🔍 Run Scan",       callback_data: "cb:scan"       },
    ],
    [
      { text: "📈 Performance",    callback_data: "cb:performance"},
      { text: "🏥 Health",         callback_data: "cb:health"     },
    ],
  ],
};

// ─── Strategy label lookup ────────────────────────────────────────────────────

const STRATEGY_LABELS: Record<string, string> = {
  "swing":                 "🌊 Swing",
  "active-swing":          "🎯 Active Swing",
  "day-trading":           "📊 Day Trading",
  "conservative-scalping": "⚡ Conservative Scalping v2",
  "scalping":              "⚡ Scalping (disabled)",
  "dca":                   "🔄 DCA (disabled)",
  "grid":                  "📐 Grid (disabled)",
};

// ─── Formatters ───────────────────────────────────────────────────────────────

function ts(): string {
  return `\n<i>${new Date().toUTCString()}</i>`;
}

function num(v: unknown, dp = 2): string {
  const n = Number(v);
  return isNaN(n) ? "—" : n.toFixed(dp);
}

function upStr(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function fmtStatus(): string {
  const s        = buildStatus();
  const pos      = s.position;
  const modeIcon = s.mode === "LIVE" ? "⚡" : s.mode === "PAPER" ? "📄" : "🔑";
  const runIcon  = s.isRunning ? "🟢 Running" : "🔴 Stopped";
  const posLine  = pos
    ? `📍 <b>${s.symbol}</b> | entry <b>$${pos.entry}</b> | TP ${(pos.tp * 100).toFixed(2)}% | SL ${(pos.sl * 100).toFixed(2)}%`
    : `📍 Position: <i>none</i>`;
  const riskLine = s.risk.isHalted
    ? `🚨 Risk: <b>HALTED</b> — ${s.risk.haltReason ?? "limit reached"}`
    : `✅ Risk: OK`;
  const stratLabel = STRATEGY_LABELS[getBotActiveStrategy()] ?? getBotActiveEngine();

  return (
    `🤖 <b>Pro Crypto Bot — Status</b>\n\n` +
    `${runIcon}  ${modeIcon} ${s.mode}\n` +
    `🎯 Strategy: <b>${stratLabel}</b>\n` +
    `🔤 Symbol: <code>${s.symbol}</code>\n` +
    `💵 Price: <b>$${s.lastPrice > 0 ? s.lastPrice.toFixed(2) : "—"}</b>\n` +
    `💰 Balance: <b>$${s.balanceUSDT.toFixed(2)}</b>\n` +
    `📈 Daily P&L: <b>${s.dailyPnL >= 0 ? "+" : ""}$${s.dailyPnL.toFixed(2)}</b>\n\n` +
    `${posLine}\n\n` +
    `📊 Trades: ${s.totalTrades} | W: ${s.winningTrades} | L: ${s.losingTrades} | WR: ${s.winRate}%\n` +
    `${riskLine}\n` +
    `⏱ Uptime: ${s.isRunning ? upStr(s.uptime) : "—"}\n` +
    `🔢 Tick: ${s.tickCount}` +
    ts()
  );
}

function fmtBalance(): string {
  const s = buildStatus();
  const isPaper = s.testMode;
  return (
    `💰 <b>Balance</b>\n\n` +
    `Mode: ${isPaper ? "📄 PAPER" : "⚡ LIVE"}\n` +
    `Balance: <b>$${s.balanceUSDT.toFixed(2)} USDT</b>\n` +
    `Daily P&L: <b>${s.dailyPnL >= 0 ? "+" : ""}$${s.dailyPnL.toFixed(2)}</b>\n` +
    `Trades today: ${s.totalTrades} | Win Rate: ${s.winRate}%` +
    ts()
  );
}

function fmtPositions(): string {
  const s   = buildStatus();
  const pos = s.position;
  if (!pos) {
    return `📍 <b>Positions</b>\n\n<i>No open position.</i>${ts()}`;
  }
  const pnl = (s.lastPrice - pos.entry) * pos.qty;
  const pct  = ((s.lastPrice - pos.entry) / pos.entry * 100).toFixed(2);
  return (
    `📍 <b>Open Position</b>\n\n` +
    `Symbol: <code>${s.symbol}</code>\n` +
    `Entry: <b>$${pos.entry}</b>\n` +
    `Current: <b>$${s.lastPrice.toFixed(2)}</b>\n` +
    `Qty: ${pos.qty}\n` +
    `Unrealized P&L: <b>${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)} (${pct}%)</b>\n` +
    `Take-Profit: $${(pos.entry * (1 + pos.tp)).toFixed(2)}\n` +
    `Stop-Loss:   $${(pos.entry * (1 - pos.sl)).toFixed(2)}` +
    ts()
  );
}

function fmtPerformance(): string {
  const p = performanceTracker.getSnapshot();
  const sign = (n: number) => n >= 0 ? "+" : "";
  if (p.totalTrades === 0) {
    return `📈 <b>Performance</b>\n\n<i>No completed trades yet.</i>${ts()}`;
  }
  return (
    `📈 <b>Performance Analytics</b>\n\n` +
    `Total Trades: <b>${p.totalTrades}</b>\n` +
    `Win Rate: <b>${num(p.winRate, 1)}%</b>\n` +
    `Profit Factor: <b>${p.profitFactor > 0 ? num(p.profitFactor) : "—"}</b>\n` +
    `Avg Hold: <b>${p.avgHoldMins > 0 ? num(p.avgHoldMins, 1) + "m" : "—"}</b>\n` +
    `Max Drawdown: <b>${p.maxDrawdownPct > 0 ? num(p.maxDrawdownPct) + "%" : "—"}</b>\n` +
    `Session ROI: <b>${sign(p.sessionRoiPct)}${num(p.sessionRoiPct)}%</b>\n\n` +
    `7-Day P&L:  <b>${sign(p.weekly7dPnl)}$${num(p.weekly7dPnl)}</b>\n` +
    `30-Day P&L: <b>${sign(p.monthly30dPnl)}$${num(p.monthly30dPnl)}</b>\n` +
    `Total P&L:  <b>${sign(p.totalPnlUsd)}$${num(p.totalPnlUsd)}</b>` +
    ts()
  );
}

function fmtScanner(): string {
  const s  = buildStatus();
  const sc = s.scanner;
  if (!sc) return `🔍 <b>Scanner</b>\n\n<i>No scanner data.</i>${ts()}`;
  const stateEmoji =
    sc.state === "QUALIFIED" ? "✅" :
    sc.state === "WAITING"   ? "⏳" : "🔄";
  return (
    `🔍 <b>Auto Scanner</b>\n\n` +
    `Mode: <b>${sc.mode?.toUpperCase() ?? "—"}</b>\n` +
    `State: ${stateEmoji} <b>${sc.state}</b>\n` +
    `Selected: <code>${sc.selectedSymbol ?? "none"}</code>\n` +
    `Min Score: ${sc.minimumScore}\n` +
    `Best Score: ${sc.bestScore ?? "—"}\n` +
    `Watchlist: ${sc.approvedSymbols?.join(", ") ?? "—"}` +
    (sc.reason ? `\nReason: <i>${sc.reason}</i>` : "") +
    ts()
  );
}

function fmtSignals(): string {
  const s   = buildStatus();
  const sig = s.strategy;
  if (!sig) {
    return `📡 <b>Live Signal</b>\n\n<i>No signal computed yet — start the bot first.</i>${ts()}`;
  }
  const ago = s.lastIndicatorUpdate
    ? `${Math.floor((Date.now() - s.lastIndicatorUpdate) / 1000)}s ago`
    : "—";
  const volStr = (sig.currentVol != null && sig.avgVol != null && sig.avgVol > 0)
    ? `${(sig.currentVol / sig.avgVol).toFixed(2)}x`
    : "—";
  const actionEmoji = sig.action === "BUY" ? "🟢" : sig.action === "SELL" ? "🔴" : "⬛";
  return (
    `📡 <b>Live Signal — ${s.symbol}</b>\n\n` +
    `${actionEmoji} Action: <b>${sig.action}</b>` +
    (sig.confidence > 0 ? ` (${sig.confidence}%)` : "") + "\n" +
    `RSI: <b>${sig.rsi?.toFixed(1) ?? "—"}</b>\n` +
    `Vol Ratio: <b>${volStr}</b>\n` +
    `Can Trade: <b>${sig.canTrade ? "✅ Yes" : "❌ No"}</b>\n` +
    (sig.reason ? `Reason: <i>${sig.reason}</i>\n` : "") +
    (sig.blockReason ? `⛔ Blocked: <i>${sig.blockReason}</i>\n` : "") +
    `Updated: ${ago}` +
    ts()
  );
}

function fmtHealth(): string {
  const s     = buildStatus();
  const risk  = getRiskState();
  const botOk = s.isRunning ? "🟢" : "🟡";
  const riskOk = risk.isHalted ? "🔴" : "🟢";
  return (
    `🏥 <b>System Health</b>\n\n` +
    `Bot:       ${botOk} ${s.isRunning ? "Running" : "Stopped"}\n` +
    `Mode:      ${s.testMode ? "📄 PAPER" : "⚡ LIVE"}\n` +
    `Risk:      ${riskOk} ${risk.isHalted ? "HALTED" : "OK"}\n` +
    `Keys:      ${s.keysReady ? "✅" : "❌"} ${s.apiKeyMask || "—"}\n` +
    `Telegram:  ✅ connected\n` +
    `Ticks:     ${s.tickCount}\n` +
    `Uptime:    ${s.isRunning ? upStr(s.uptime) : "—"}\n` +
    `Daily Loss: $${risk.dailyPnlUsd?.toFixed(2) ?? "0.00"} / $${Math.abs(risk.config?.maxDailyLossUsd ?? 50)}` +
    ts()
  );
}

function fmtTradeCount(strategy?: string): string {
  const today = new Date().toISOString().slice(0, 10);

  if (strategy === "conservative-scalping") {
    const c    = getCSCounters();
    const proj = getCSProjection();
    const todayCount = c.byDay[today] ?? 0;
    const onTarget   = proj >= CS_PARAMS.targetMin && proj <= CS_PARAMS.targetMax;
    const topSymbols = Object.entries(c.bySymbol).sort(([,a],[,b]) => b - a).slice(0, 5);
    const symbolLines = topSymbols.length > 0
      ? topSymbols.map(([sym, n]) => `  <code>${sym}</code>: ${n}/${CS_PARAMS.symbolMonthlyCap}`).join("\n")
      : "  <i>No trades yet this month</i>";

    return (
      `⚡ <b>Conservative Scalping v2 — Trade Counts</b>\n\n` +
      `📅 Month: <b>${c.month}</b>\n` +
      `Monthly total: <b>${c.total} / ${CS_PARAMS.monthlyCap}</b>\n` +
      `Today: <b>${todayCount} / ${CS_PARAMS.dailyCap}</b>\n\n` +
      `📊 Monthly projection: <b>~${proj} trades</b> ` +
      `${onTarget ? "✅ on target" : proj < CS_PARAMS.targetMin ? "⚠️ below target" : "⚠️ above target"}\n` +
      `Target range: ${CS_PARAMS.targetMin}–${CS_PARAMS.targetMax} / month\n` +
      `Entry frame: <b>15m EMA9/21</b>  Trend: <b>15m EMA50/200</b>\n\n` +
      `<b>By Symbol (this month):</b>\n${symbolLines}` +
      ts()
    );
  }

  // Default: Active Swing
  const counters    = getTradeCounters();
  const projection  = getMonthlyProjection();
  const todayCount  = counters.byDay[today] ?? 0;
  const onTarget    = projection >= 20 && projection <= 30;
  const topSymbols  = Object.entries(counters.bySymbol).sort(([,a],[,b]) => b - a).slice(0, 5);

  const symbolLines = topSymbols.length > 0
    ? topSymbols.map(([sym, n]) => `  <code>${sym}</code>: ${n}/10`).join("\n")
    : "  <i>No trades yet this month</i>";

  return (
    `🎯 <b>Active Swing — Trade Counts</b>\n\n` +
    `📅 Month: <b>${counters.month}</b>\n` +
    `Monthly total: <b>${counters.total} / 30</b>\n` +
    `Today: <b>${todayCount} / 2</b>\n\n` +
    `📊 Monthly projection: <b>~${projection} trades</b> ` +
    `${onTarget ? "✅ on target" : projection < 20 ? "⚠️ below target" : "⚠️ above target"}\n` +
    `Target range: 20–30 / month\n\n` +
    `<b>By Symbol (this month):</b>\n${symbolLines}` +
    ts()
  );
}

function fmtCSPerformance(): string {
  const p = performanceTracker.getSnapshot();
  const c = getCSCounters();
  const proj = getCSProjection();
  const sign = (n: number) => n >= 0 ? "+" : "";

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 6);
  let weekTrades = 0;
  for (const [day, count] of Object.entries(c.byDay)) {
    if (new Date(day) >= weekStart) weekTrades += count;
  }
  const avgPerDay = weekTrades / 7;
  const onTarget  = proj >= CS_PARAMS.targetMin && proj <= CS_PARAMS.targetMax;

  return (
    `⚡ <b>Conservative Scalping v2 — Performance</b>\n\n` +
    `Total Trades: <b>${p.totalTrades}</b>\n` +
    `Win Rate: <b>${num(p.winRate, 1)}%</b>\n` +
    `Profit Factor: <b>${p.profitFactor > 0 ? num(p.profitFactor) : "—"}</b>\n` +
    `Avg Hold: <b>${p.avgHoldMins > 0 ? num(p.avgHoldMins, 1) + "m" : "—"}</b>\n` +
    `Max Drawdown: <b>${p.maxDrawdownPct > 0 ? num(p.maxDrawdownPct) + "%" : "—"}</b>\n` +
    `Session ROI: <b>${sign(p.sessionRoiPct)}${num(p.sessionRoiPct)}%</b>\n\n` +
    `<b>📅 Weekly Summary</b>\n` +
    `Trades this week: <b>${weekTrades}</b>\n` +
    `Avg trades/day: <b>${avgPerDay.toFixed(1)}</b>  (target 1–3)\n` +
    `Monthly projection: <b>~${proj} trades</b> ${onTarget ? "✅" : "⚠️"} (target 30–60)\n\n` +
    `<b>📆 P&L</b>\n` +
    `7-Day P&L:  <b>${sign(p.weekly7dPnl)}$${num(p.weekly7dPnl)}</b>\n` +
    `30-Day P&L: <b>${sign(p.monthly30dPnl)}$${num(p.monthly30dPnl)}</b>\n` +
    `Total P&L:  <b>${sign(p.totalPnlUsd)}$${num(p.totalPnlUsd)}</b>\n\n` +
    `<b>⚙️ v2 Parameters</b>\n` +
    `Entry: EMA9/21 (15m)  |  Trend: EMA50/200 (15m)\n` +
    `RSI: 40–65  |  Vol: ≥0.8×  |  ATR: 0.2–1.5%\n` +
    `SL: 0.7%  |  TP: 1.2%  |  R:R ≈ 1:1.71` +
    ts()
  );
}

function fmtActiveSwingPerformance(): string {
  const p = performanceTracker.getSnapshot();
  const c = getTradeCounters();
  const projection = getMonthlyProjection();
  const sign = (n: number) => n >= 0 ? "+" : "";

  // Week count from byDay
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 6);
  let weekTrades = 0;
  for (const [day, count] of Object.entries(c.byDay)) {
    if (new Date(day) >= weekStart) weekTrades += count;
  }
  const avgTradesPerDay = weekTrades / 7;

  return (
    `🎯 <b>Active Swing Performance</b>\n\n` +
    `Total Trades: <b>${p.totalTrades}</b>\n` +
    `Win Rate: <b>${num(p.winRate, 1)}%</b>\n` +
    `Profit Factor: <b>${p.profitFactor > 0 ? num(p.profitFactor) : "—"}</b>\n` +
    `Avg Hold: <b>${p.avgHoldMins > 0 ? num(p.avgHoldMins, 1) + "m" : "—"}</b>\n` +
    `Max Drawdown: <b>${p.maxDrawdownPct > 0 ? num(p.maxDrawdownPct) + "%" : "—"}</b>\n` +
    `Session ROI: <b>${sign(p.sessionRoiPct)}${num(p.sessionRoiPct)}%</b>\n\n` +
    `<b>📅 Weekly Summary</b>\n` +
    `Trades this week: <b>${weekTrades}</b>\n` +
    `Avg trades/day: <b>${avgTradesPerDay.toFixed(1)}</b>\n` +
    `Monthly projection: <b>~${projection} trades</b> (target 20–30)\n\n` +
    `<b>📆 P&L</b>\n` +
    `7-Day P&L:  <b>${sign(p.weekly7dPnl)}$${num(p.weekly7dPnl)}</b>\n` +
    `30-Day P&L: <b>${sign(p.monthly30dPnl)}$${num(p.monthly30dPnl)}</b>\n` +
    `Total P&L:  <b>${sign(p.totalPnlUsd)}$${num(p.totalPnlUsd)}</b>` +
    ts()
  );
}

function fmtHelp(): string {
  return (
    `🤖 <b>Pro Crypto Bot — Commands</b>\n\n` +
    `<b>ℹ️ Info</b>\n` +
    `/status      — full bot status + position\n` +
    `/balance     — balance &amp; daily P&L\n` +
    `/positions   — open positions\n` +
    `/performance — profit factor, drawdown, ROI\n` +
    `/performance active-swing — Active Swing analytics + weekly report\n` +
    `/performance conservative-scalping — Conservative Scalping v2 analytics\n` +
    `/tradecount  — Active Swing trade counts (monthly/daily/symbol)\n` +
    `/tradecount conservative-scalping — Conservative Scalping v2 trade counts\n` +
    `/scanner     — auto-scanner state\n` +
    `/signals     — latest signal data\n` +
    `/health      — system health check\n\n` +
    `<b>🎮 Control</b>\n` +
    `/startbot    — start the trading engine\n` +
    `/stopbot     — stop (requires /confirm)\n` +
    `/pause       — immediate pause\n` +
    `/resume      — resume trading\n` +
    `/paper       — switch to paper mode\n` +
    `/live        — switch to LIVE mode (requires /confirm)\n\n` +
    `<b>🎯 Strategy</b>\n` +
    `/strategy                    — show active strategy\n` +
    `/strategy active-swing       — Active Swing details + counters\n` +
    `/strategy conservative-scalping — Conservative Scalping v2 details + counters\n` +
    `/setstrategy swing            — Swing (long holds, 4h)\n` +
    `/setstrategy active-swing     — Active Swing (20–30 trades/month, 4h)\n` +
    `/setstrategy conservative-scalping — Cons. Scalping v2 (30–60 trades/month, 15m)\n` +
    `/setstrategy day-trading      — Day Trading\n\n` +
    `<b>🌍 Markets</b>\n` +
    `/scan           — trigger a market scan now\n` +
    `/watchlist      — show approved symbols\n` +
    `/topmarkets     — top scan results\n` +
    `/opportunities  — scan 10 symbols for Active Swing buy signals\n\n` +
    `<b>📡 Manual Trade</b>\n` +
    `/trade signal BTC/USDT swing                — Swing signal\n` +
    `/trade signal BTC/USDT active-swing         — Active Swing signal\n` +
    `/trade signal BTC/USDT conservative-scalping — ConservativeScalping v2 signal\n` +
    `/trade buy &lt;symbol&gt; [usdt]   — market buy (requires /confirm)\n` +
    `/trade sell &lt;symbol&gt; [coins] — market sell (requires /confirm)\n\n` +
    `<b>⚔️ Benchmark</b>\n` +
    `/benchmark start [symbol]  — Swing vs Active Swing vs Cons.Scalping v2\n` +
    `/benchmark status          — check progress\n` +
    `/benchmark results         — 3-strategy comparison (Phase 8.4)\n\n` +
    `<b>✅ Confirmation</b>\n` +
    `/confirm     — confirm a pending action\n` +
    `/cancel      — cancel a pending action\n\n` +
    `<i>Destructive actions (stop, live, setstrategy while running) require /confirm.</i>`
  );
}

function fmtWatchlist(): string {
  const s  = buildStatus();
  const sc = s.scanner;
  const symbols = sc?.approvedSymbols ?? [];
  if (symbols.length === 0) {
    return `📋 <b>Watchlist</b>\n\n<i>No symbols configured.</i>${ts()}`;
  }
  return (
    `📋 <b>Watchlist (${symbols.length} symbols)</b>\n\n` +
    symbols.map((sym, i) => `${i + 1}. <code>${sym}</code>`).join("\n") +
    ts()
  );
}

// ─── Command handlers ─────────────────────────────────────────────────────────

async function doStartBot(chatId: number): Promise<void> {
  if (getBotIsRunning()) {
    await sendMsg(chatId, `ℹ️ Bot is already running.\nSend /status to check its state.`);
    return;
  }
  await sendMsg(chatId, `⏳ Starting bot…`);
  const r = await start();
  if (r.ok) {
    await sendMsg(chatId, `▶️ <b>Bot started.</b>\n${fmtStatus()}`, MAIN_KB);
  } else {
    await sendMsg(chatId, `❌ <b>Could not start:</b>\n${r.error ?? "unknown error"}`);
  }
}

async function doStopBot(chatId: number): Promise<void> {
  const r = stop("USER_STOP");
  await sendMsg(
    chatId,
    r.ok
      ? `⏹ <b>Bot stopped.</b>\nSend /startbot or /resume to restart.`
      : `❌ Could not stop the bot.`,
    MAIN_KB,
  );
}

async function doSwitchLive(chatId: number): Promise<void> {
  const s = buildStatus();
  if (!s.keysReady) {
    await sendMsg(chatId, `❌ Cannot switch to LIVE mode — API keys not configured.\nSet your keys in the dashboard first.`);
    return;
  }
  const wasRunning = getBotIsRunning();
  if (wasRunning) stop("MODE_CHANGE");
  setConfig({ testMode: false });
  if (wasRunning) {
    await sendMsg(chatId, `⏳ Switching to LIVE mode and restarting…`);
    const r = await start();
    if (r.ok) {
      await sendMsg(chatId, `⚡ <b>LIVE mode activated.</b>\nBot restarted with real keys.`);
    } else {
      setConfig({ testMode: true });
      await sendMsg(chatId, `❌ Failed to start in LIVE mode — reverted to PAPER.\n${r.error ?? ""}`);
    }
  } else {
    await sendMsg(chatId, `⚡ <b>Switched to LIVE mode.</b>\nSend /startbot when ready.`);
  }
}

async function doSwitchPaper(chatId: number): Promise<void> {
  const wasRunning = getBotIsRunning();
  if (wasRunning) stop("MODE_CHANGE");
  setConfig({ testMode: true });
  if (wasRunning) {
    await sendMsg(chatId, `⏳ Switching to PAPER mode and restarting…`);
    const r = await start();
    if (r.ok) {
      await sendMsg(chatId, `📄 <b>PAPER mode activated.</b>\nBot restarted in simulation.`);
    } else {
      await sendMsg(chatId, `❌ Failed to restart in PAPER mode.\n${r.error ?? ""}`);
    }
  } else {
    await sendMsg(chatId, `📄 <b>Switched to PAPER mode.</b>\nSend /startbot when ready.`);
  }
}

async function doScan(chatId: number): Promise<void> {
  await sendMsg(chatId, `🔍 Running market scan…`);
  try {
    const results = await triggerScan();
    if (!results || results.length === 0) {
      await sendMsg(chatId, `🔍 <b>Scan complete</b>\n\n<i>No results returned.</i>${ts()}`);
      return;
    }
    const top = results.slice(0, 5);
    const lines = top.map((r, i) =>
      `${i + 1}. <code>${r.symbol}</code>  score <b>${r.score}/100</b>` +
      (r.regime ? ` · ${r.regime}` : "") +
      (r.rejected ? ` ⛔` : "")
    );
    await sendMsg(
      chatId,
      `🔍 <b>Scan Results</b>\n\n${lines.join("\n")}\n\nTop: <b>${results.find(r => !r.rejected)?.symbol ?? "none"}</b>${ts()}`,
    );
  } catch (e) {
    await sendMsg(chatId, `❌ Scan failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function doTopMarkets(chatId: number): Promise<void> {
  const s  = buildStatus();
  const sc = s.scanner;
  const results = (sc as any)?.lastResults as Array<{ symbol: string; score: number; regime?: string; rejected?: boolean }> | undefined;
  if (!results || results.length === 0) {
    await sendMsg(chatId, `📊 <b>Top Markets</b>\n\n<i>No scan data — send /scan to run one.</i>${ts()}`);
    return;
  }
  const lines = results.slice(0, 8).map((r, i) =>
    `${i + 1}. <code>${r.symbol}</code>  <b>${r.score}/100</b>` +
    (r.regime ? ` · ${r.regime}` : "") +
    (r.rejected ? " ⛔" : " ✅")
  );
  await sendMsg(chatId, `📊 <b>Top Markets (last scan)</b>\n\n${lines.join("\n")}${ts()}`);
}

// ─── Main update handler ──────────────────────────────────────────────────────

export async function handleUpdate(update: TgUpdate): Promise<void> {
  // ── Callback query (inline button press) ──────────────────────────────────
  if (update.callback_query) {
    const cb     = update.callback_query;
    const userId = cb.from.id;
    const chatId = cb.message?.chat.id ?? cb.from.id;
    await answerCallback(cb.id);

    if (!isAdmin(userId)) {
      logger.warn({ userId, username: cb.from.username }, "telegramWebhook: unauthorized callback blocked");
      return;
    }

    const data = cb.data ?? "";
    switch (data) {
      case "cb:startbot":    await doStartBot(chatId);  break;
      case "cb:stopbot":
        setPending(userId, "stop bot", async () => { await doStopBot(chatId); return ""; });
        await sendMsg(chatId, `⚠️ Type /confirm to stop the bot, or /cancel to abort.`);
        break;
      case "cb:status":      await sendMsg(chatId, fmtStatus(), MAIN_KB); break;
      case "cb:balance":     await sendMsg(chatId, fmtBalance()); break;
      case "cb:positions":   await sendMsg(chatId, fmtPositions()); break;
      case "cb:scan":        await doScan(chatId); break;
      case "cb:performance": await sendMsg(chatId, fmtPerformance()); break;
      case "cb:health":      await sendMsg(chatId, fmtHealth()); break;
    }
    return;
  }

  // ── Text message ──────────────────────────────────────────────────────────
  const msg = update.message;
  if (!msg?.text) return;

  const userId  = msg.from?.id ?? 0;
  const chatId  = msg.chat.id;
  const rawText = msg.text.split("@")[0]?.trim() ?? "";
  const cmd     = rawText.toLowerCase();

  // Security: admin check
  if (!isAdmin(userId)) {
    logger.warn(
      { userId, username: msg.from?.username, cmd },
      "telegramWebhook: unauthorized command blocked",
    );
    await sendMsg(chatId, `🚫 Unauthorized. This bot only accepts commands from its admin.`);
    return;
  }

  // ── /confirm ──────────────────────────────────────────────────────────────
  if (cmd === "/confirm") {
    const pending = pendingMap.get(userId);
    if (!pending) {
      await sendMsg(chatId, `ℹ️ Nothing to confirm. Pending actions expire after 60 seconds.`);
      return;
    }
    if (Date.now() > pending.expiresAt) {
      clearPending(userId);
      await sendMsg(chatId, `⏰ The pending action <b>"${pending.action}"</b> has expired. Please run the command again.`);
      return;
    }
    clearPending(userId);
    const result = await pending.fn();
    if (result) await sendMsg(chatId, result);
    return;
  }

  // ── /cancel ───────────────────────────────────────────────────────────────
  if (cmd === "/cancel") {
    const pending = pendingMap.get(userId);
    clearPending(userId);
    await sendMsg(
      chatId,
      pending
        ? `✅ Cancelled <b>"${pending.action}"</b>.`
        : `ℹ️ Nothing pending to cancel.`,
    );
    return;
  }

  // ── /strategy [id] — show strategy info ──────────────────────────────────
  if (cmd === "/strategy" || cmd.startsWith("/strategy ")) {
    const parts = rawText.trim().split(/\s+/);
    const arg   = (parts[1] ?? "").toLowerCase();

    if (arg === "active-swing") {
      const counters   = getTradeCounters();
      const projection = getMonthlyProjection();
      const today      = new Date().toISOString().slice(0, 10);
      const todayCount = counters.byDay[today] ?? 0;
      const onTarget   = projection >= 20 && projection <= 30;
      await sendMsg(chatId,
        `🎯 <b>Active Swing Strategy — Phase 8.4</b>\n\n` +
        `Timeframe: <b>4h</b> (trend + entry)\n` +
        `Trend Filter: EMA50 &gt; EMA200 (4h)\n` +
        `Entry: EMA20 &gt; EMA50 crossover (4h)\n` +
        `RSI: 35–65  |  Volume: ≥ 0.8× avg\n` +
        `Min conditions: 4 / 5\n\n` +
        `SL: 1.2%  |  TP: 2.0%  |  R:R ≈ 1.67\n\n` +
        `<b>📅 Trade Counters</b>\n` +
        `Monthly: <b>${counters.total} / 30</b>\n` +
        `Today:   <b>${todayCount} / 2</b>\n` +
        `Projection: <b>~${projection}</b> ${onTarget ? "✅ on target" : "⚠️"}\n\n` +
        `Approved symbols: 10\n` +
        `Use /tradecount for symbol breakdown.` + ts()
      );
      return;
    }

    if (arg === "conservative-scalping") {
      const c    = getCSCounters();
      const proj = getCSProjection();
      const today = new Date().toISOString().slice(0, 10);
      const todayCount = c.byDay[today] ?? 0;
      const onTarget   = proj >= CS_PARAMS.targetMin && proj <= CS_PARAMS.targetMax;
      await sendMsg(chatId,
        `⚡ <b>Conservative Scalping v2 — Phase 8.4 Update</b>\n\n` +
        `Trend Frame: <b>15m</b> EMA50 &gt; EMA200\n` +
        `Entry Frame: <b>15m</b> EMA9 &gt; EMA21\n` +
        `RSI: 40–65  |  Volume: ≥ 0.8× avg\n` +
        `ATR: 0.2%–1.5%  |  Price &gt; EMA21\n` +
        `Min conditions: 4 / 6\n\n` +
        `SL: 0.7%  |  TP: 1.2%  |  R:R ≈ 1:1.71\n` +
        `Daily cap: 6  |  Monthly cap: 60\n` +
        `Symbol cap: 15/month  |  Target: 30–60/month\n\n` +
        `<b>📅 Trade Counters</b>\n` +
        `Monthly: <b>${c.total} / ${CS_PARAMS.monthlyCap}</b>\n` +
        `Today:   <b>${todayCount} / ${CS_PARAMS.dailyCap}</b>\n` +
        `Projection: <b>~${proj}</b> ${onTarget ? "✅ on target" : proj < CS_PARAMS.targetMin ? "⚠️ below" : "⚠️ above"}\n\n` +
        `Approved symbols: 10 (incl. DOGE, SUI)\n` +
        `Use /tradecount conservative-scalping for details.` + ts()
      );
      return;
    }

    const id    = getBotActiveStrategy();
    const eng   = getBotActiveEngine();
    const label = STRATEGY_LABELS[id] ?? eng;
    const activeList = (ACTIVE_STRATEGY_IDS as readonly string[])
      .map(s => `  • <code>${s}</code>${s === id ? " ✅" : ""}`)
      .join("\n");
    await sendMsg(
      chatId,
      `🎯 <b>Active Strategy</b>\n\n` +
      `ID: <code>${id}</code>\n` +
      `Engine: <b>${eng}</b>\n` +
      `Label: ${label}\n\n` +
      `<b>Available active strategies:</b>\n${activeList}\n\n` +
      `Use /setstrategy &lt;id&gt; to switch.\n` +
      `Use /strategy active-swing for Active Swing details.` +
      ts(),
    );
    return;
  }

  // ── /setstrategy <id> — switch strategy (requires confirm if running) ──────
  if (cmd.startsWith("/setstrategy")) {
    const parts  = rawText.trim().split(/\s+/);
    const newId  = (parts[1] ?? "").toLowerCase();

    if (!newId) {
      const list = (ACTIVE_STRATEGY_IDS as readonly string[]).map(s => `<code>${s}</code>`).join(" | ");
      await sendMsg(chatId, `⚠️ Usage: /setstrategy &lt;id&gt;\n\nActive strategies: ${list}`);
      return;
    }

    if (!(ACTIVE_STRATEGY_IDS as readonly string[]).includes(newId)) {
      const list = (ACTIVE_STRATEGY_IDS as readonly string[]).map(s => `<code>${s}</code>`).join(" | ");
      await sendMsg(chatId,
        `❌ <b>"${newId}"</b> is not an active strategy.\n\nActive strategies: ${list}`);
      return;
    }

    const current = getBotActiveStrategy();
    if (newId === current) {
      await sendMsg(chatId, `ℹ️ Strategy is already set to <b>${STRATEGY_LABELS[newId] ?? newId}</b>.`);
      return;
    }

    const newLabel = STRATEGY_LABELS[newId] ?? newId;

    if (getBotIsRunning()) {
      setPending(userId, `switch strategy to ${newLabel}`, async () => {
        setConfig({ strategy: newId });
        return (
          `🎯 <b>Strategy switched to ${newLabel}</b>\n` +
          `Bot continues running with the new engine.${ts()}`
        );
      });
      await sendMsg(
        chatId,
        `⚠️ <b>Switch strategy to ${newLabel}?</b>\n\n` +
        `The bot is currently running. It will continue with the new strategy immediately.\n\n` +
        `Type /confirm within 60s to proceed, or /cancel to abort.`,
      );
    } else {
      setConfig({ strategy: newId });
      await sendMsg(chatId,
        `🎯 <b>Strategy set to ${newLabel}</b>\nSend /startbot to begin trading.${ts()}`);
    }
    return;
  }

  // ── /benchmark <start|status|results> ────────────────────────────────────
  if (cmd.startsWith("/benchmark")) {
    const parts = rawText.trim().split(/\s+/);
    const sub   = (parts[1] ?? "").toLowerCase();

    if (sub === "start") {
      const rawArg = parts[2] ?? "BTC_USDT";
      let sym: string;
      try {
        sym = toGateApiSymbol(rawArg);
      } catch {
        await sendMsg(chatId, `⚠️ <b>Invalid symbol:</b> <code>${rawArg}</code>\nUse Gate.io format e.g. <code>BTC_USDT</code>`);
        return;
      }
      const r = await startBenchmark({ symbol: sym });
      if (!r.ok) {
        await sendMsg(chatId, `⚠️ <b>Benchmark:</b> ${r.error ?? "Failed to start"}`);
      } else {
        await sendMsg(chatId,
          `⚔️ <b>Benchmark started</b>\n\n` +
          `Strategies:\n` +
          `  📊 SwingStrategy (4h)\n` +
          `  🎯 ActiveSwingStrategy (4h) — Phase 8.4\n` +
          `  ⚡ ConservativeScalpingStrategy (15m)\n\n` +
          `Symbol: ${sym} · 20 trades each · native timeframes\n\n` +
          `Use /benchmark status to check progress.\n` +
          `Use /benchmark results when complete.${ts()}`);
      }
      return;
    }

    if (sub === "status") {
      const s = getBenchmarkState();
      const statusIcon = s.status === "running" ? "⏳" : s.status === "complete" ? "✅" : s.status === "error" ? "❌" : "💤";
      let msg = `⚔️ <b>Benchmark Status</b>\n\n${statusIcon} <b>${s.status.toUpperCase()}</b>`;
      if (s.startedAt) msg += `\nStarted: ${new Date(s.startedAt).toLocaleTimeString()}`;
      if (s.completedAt) msg += `\nCompleted: ${new Date(s.completedAt).toLocaleTimeString()}`;
      if (s.status === "running") msg += `\n\nSimulation in progress — send /benchmark results after completion.`;
      if (s.error) msg += `\n\nError: ${s.error}`;
      msg += ts();
      await sendMsg(chatId, msg);
      return;
    }

    if (sub === "results") {
      const s = getBenchmarkState();
      if (s.status === "idle")    { await sendMsg(chatId, `💤 No benchmark has been run yet.\nSend /benchmark start to begin.`); return; }
      if (s.status === "running") { await sendMsg(chatId, `⏳ Benchmark is still running. Try again shortly.`); return; }
      if (s.status === "error")   { await sendMsg(chatId, `❌ <b>Benchmark failed:</b> ${s.error}`); return; }

      const sw = s.swing!;
      const as_ = s.activeSwing!;
      const cs = s.scalping!;
      const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

      const allComplete  = sw.targetReached && as_.targetReached && cs.targetReached;
      const combinedConf = Math.min(sw.confidenceScore, as_.confidenceScore, cs.confidenceScore);
      const confLabel    = combinedConf < 50 ? "LOW" : combinedConf < 80 ? "MEDIUM" : "HIGH";
      const confWarn     = !allComplete
        ? `\n\n⚠ <b>Benchmark confidence: ${confLabel} (${combinedConf}%)</b>\nResults may not be statistically significant.` : "";

      // Active Swing verification
      const asOnTarget = as_.tradesPerMonth >= 20 && as_.tradesPerMonth <= 30;
      const asPfOk     = as_.profitFactor >= 1.3;
      const asDdOk     = as_.maxDrawdown < 10;

      await sendMsg(chatId,
        `⚔️ <b>Benchmark Results — Phase 8.4</b>\n` +
        `\n<b>📊 SwingStrategy</b> (${sw.timeframe})\n` +
        `  Trades: ${sw.tradesCompleted}/${sw.targetTrades} ${sw.targetReached ? "✓" : "⚠"}\n` +
        `  ROI: <b>${fmtPct(sw.roi)}</b>  WR: <b>${sw.winRate.toFixed(0)}%</b>\n` +
        `  DD: ${sw.maxDrawdown.toFixed(1)}%  PF: ${sw.profitFactor >= 999 ? "∞" : sw.profitFactor.toFixed(2)}\n` +
        `  ~${sw.tradesPerMonth.toFixed(1)} trades/month\n` +
        `\n<b>🎯 ActiveSwingStrategy</b> (${as_.timeframe}) — Phase 8.4\n` +
        `  Trades: ${as_.tradesCompleted}/${as_.targetTrades} ${as_.targetReached ? "✓" : "⚠"}\n` +
        `  ROI: <b>${fmtPct(as_.roi)}</b>  WR: <b>${as_.winRate.toFixed(0)}%</b>\n` +
        `  DD: ${as_.maxDrawdown.toFixed(1)}%  PF: ${as_.profitFactor >= 999 ? "∞" : as_.profitFactor.toFixed(2)}\n` +
        `  ~${as_.tradesPerMonth.toFixed(1)} trades/month  Avg hold: ${as_.avgTradeDuration < 60 ? Math.round(as_.avgTradeDuration) + "m" : (as_.avgTradeDuration/60).toFixed(1) + "h"}\n` +
        `  ✓ Target 20–30/mo: ${asOnTarget ? "✅" : "⚠️ " + as_.tradesPerMonth.toFixed(1)}  PF≥1.3: ${asPfOk ? "✅" : "⚠️"}  DD<10%: ${asDdOk ? "✅" : "⚠️"}\n` +
        `\n<b>⚡ ConservativeScalpingStrategy</b> (${cs.timeframe})\n` +
        `  Trades: ${cs.tradesCompleted}/${cs.targetTrades} ${cs.targetReached ? "✓" : "⚠"}\n` +
        `  ROI: <b>${fmtPct(cs.roi)}</b>  WR: <b>${cs.winRate.toFixed(0)}%</b>\n` +
        `  DD: ${cs.maxDrawdown.toFixed(1)}%  PF: ${cs.profitFactor >= 999 ? "∞" : cs.profitFactor.toFixed(2)}\n` +
        `\n<b>↕️ Long/Short Split (Phase 8.7, Active Swing)</b>\n` +
        `  Long ROI: <b>${fmtPct(as_.longRoi)}</b> (${as_.longTrades} trades)\n` +
        `  Short ROI: <b>${fmtPct(as_.shortRoi)}</b> (${as_.shortTrades} trades)\n` +
        `  Combined ROI: <b>${fmtPct(as_.combinedRoi)}</b>` +
        confWarn + ts()
      );
      return;
    }

    // Unknown subcommand
    await sendMsg(chatId,
      `⚔️ <b>Strategy Benchmark</b>\n\n` +
      `/benchmark start [symbol]  — run Swing vs Active Swing vs Scalping\n` +
      `/benchmark status          — check simulation progress\n` +
      `/benchmark results         — view 3-strategy results`
    );
    return;
  }

  // ── /opportunities — scan 10 symbols for Active Swing buy signals ────────
  if (cmd === "/opportunities" || cmd === "/opps") {
    await sendMsg(chatId, `🔭 <b>Scanning 10 symbols for opportunities…</b>\n<i>This may take 15–30 seconds.</i>`);
    try {
      await runOpportunityScanner();
      await sendMsg(chatId, getOpportunitiesForTelegram());
    } catch (e) {
      await sendMsg(chatId, `❌ Opportunity scan failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    return;
  }

  // ── /trade signal|buy|sell ────────────────────────────────────────────────
  if (cmd.startsWith("/trade")) {
    const parts   = rawText.trim().split(/\s+/);
    const sub     = (parts[1] ?? "").toLowerCase();
    const rawSym  = parts[2] ?? "BTC/USDT";
    let sym: string;
    try {
      sym = toDisplaySymbol(rawSym); // CCXT/display format: BTC/USDT
    } catch (e) {
      if (e instanceof InvalidSymbolError) {
        await sendMsg(chatId, `⚠️ <b>Invalid symbol:</b> <code>${rawSym}</code>\nExamples: <code>BTC/USDT</code>, <code>BTC_USDT</code>, <code>BTCUSDT</code>`);
        return;
      }
      throw e;
    }

    const VALID_STRATEGIES: ManualStrategyId[] = ["swing", "active-swing", "conservative-scalping"];
    const strategyHelp =
      `  <code>swing</code> — SwingStrategy (4h candles)\n` +
      `  <code>active-swing</code> — ActiveSwingStrategy (4h candles)\n` +
      `  <code>conservative-scalping</code> — ConservativeScalpingStrategy (15m candles)`;

    // ── /trade signal <symbol> <strategy> ───────────────────────────────────
    if (sub === "signal") {
      const stratId = (parts[3] ?? "").toLowerCase() as ManualStrategyId;
      if (!VALID_STRATEGIES.includes(stratId)) {
        await sendMsg(chatId,
          `📡 <b>/trade signal usage:</b>\n\n` +
          `/trade signal BTC/USDT swing\n` +
          `/trade signal BTC/USDT conservative-scalping\n\n` +
          `Strategy options:\n${strategyHelp}`
        );
        return;
      }
      await sendMsg(chatId, `⏳ Fetching ${sym} signal from ${stratId}…`);
      try {
        const sig = await getSignalAnalysis(sym, stratId);
        const ae  = sig.action === "BUY" ? "🟢" : sig.action === "SELL" ? "🔴" : "⚪";
        const fp  = (p: number | null) => p != null ? `$${p.toFixed(2)}` : "—";
        const slLine = sig.action === "BUY" && sig.suggestedSl != null
          ? `SL: ${fp(sig.suggestedSl)}${sig.stopLossPct ? ` (−${(sig.stopLossPct * 100).toFixed(2)}%)` : ""}\n`
          : "";
        const tpLine = sig.action === "BUY" && sig.suggestedTp != null
          ? `TP: ${fp(sig.suggestedTp)}${sig.takeProfitPct ? ` (+${(sig.takeProfitPct * 100).toFixed(2)}%)` : ""}\n`
          : "";
        const buyHint = sig.action === "BUY" && sig.canTrade
          ? `\n💡 To act: /trade buy ${sym}`
          : "";
        await sendMsg(chatId,
          `📡 <b>Signal: ${sig.strategyLabel}</b>\n` +
          `${sym} · ${sig.timeframe} · @$${sig.currentPrice.toFixed(2)}\n\n` +
          `${ae} <b>${sig.action}</b>${sig.canTrade ? " — TRADEABLE" : " — HOLD"}\n` +
          `Confidence: <b>${sig.confidence}%</b>\n` +
          `Reason: ${sig.reason}\n\n` +
          slLine + tpLine + buyHint + ts()
        );
      } catch (e) {
        await sendMsg(chatId, `❌ <b>Signal error:</b> ${String(e)}`);
      }
      return;
    }

    // ── /trade buy <symbol> [amount] ─────────────────────────────────────────
    if (sub === "buy") {
      const amountUsdt = parseFloat(parts[3] ?? "") || getBotOrderSizeUsdt();
      await sendMsg(chatId, `⏳ Fetching current price for ${sym}…`);
      try {
        const sig  = await getSignalAnalysis(sym, "swing");
        const price = sig.currentPrice;
        const coins = amountUsdt / price;
        setPending(userId, `buy $${amountUsdt} of ${sym}`, async () => {
          const creds = getBotExchangeCreds();
          const r     = await placeMarketOrder(creds, { symbol: sym, side: "buy", amount: coins });
          return r.success
            ? `✅ <b>Manual buy executed</b>\n${sym} · ${coins.toFixed(6)} coins\n~$${price.toFixed(2)}\nOrder: ${r.orderId ?? "—"}`
            : `❌ <b>Buy failed:</b> ${r.error ?? "unknown error"}`;
        });
        await sendMsg(chatId,
          `⚠️ <b>Confirm manual buy?</b>\n\n` +
          `Symbol: ${sym}\n` +
          `Amount: $${amountUsdt} USDT (~${coins.toFixed(6)} coins)\n` +
          `Price: ~$${price.toFixed(2)}\n\n` +
          `Type /confirm to proceed or /cancel to abort.`
        );
      } catch (e) {
        await sendMsg(chatId, `❌ <b>Error:</b> ${String(e)}`);
      }
      return;
    }

    // ── /trade sell <symbol> [coins] ─────────────────────────────────────────
    if (sub === "sell") {
      const coinArg = parseFloat(parts[3] ?? "") || null;
      await sendMsg(chatId, `⏳ Fetching current price for ${sym}…`);
      try {
        const sig    = await getSignalAnalysis(sym, "swing");
        const price  = sig.currentPrice;
        const coins  = coinArg ?? (getBotOrderSizeUsdt() / price);
        setPending(userId, `sell ${coins.toFixed(6)} ${sym} coins`, async () => {
          const creds = getBotExchangeCreds();
          const r     = await placeMarketOrder(creds, { symbol: sym, side: "sell", amount: coins, isExit: true });
          return r.success
            ? `✅ <b>Manual sell executed</b>\n${sym} · ${coins.toFixed(6)} coins\n~$${price.toFixed(2)}\nOrder: ${r.orderId ?? "—"}`
            : `❌ <b>Sell failed:</b> ${r.error ?? "unknown error"}`;
        });
        await sendMsg(chatId,
          `⚠️ <b>Confirm manual sell?</b>\n\n` +
          `Symbol: ${sym}\n` +
          `Amount: ${coins.toFixed(6)} coins (~$${(coins * price).toFixed(2)})\n` +
          `Price: ~$${price.toFixed(2)}\n\n` +
          `Type /confirm to proceed or /cancel to abort.`
        );
      } catch (e) {
        await sendMsg(chatId, `❌ <b>Error:</b> ${String(e)}`);
      }
      return;
    }

    // ── Unknown /trade subcommand → help ─────────────────────────────────────
    await sendMsg(chatId,
      `📡 <b>Manual Trade Commands</b>\n\n` +
      `<b>Signal Analysis (no order placed)</b>\n` +
      `/trade signal BTC/USDT swing\n` +
      `/trade signal ETH/USDT conservative-scalping\n\n` +
      `<b>Execute Orders (requires /confirm)</b>\n` +
      `/trade buy &lt;symbol&gt; [usdt]   — market buy\n` +
      `/trade sell &lt;symbol&gt; [coins] — market sell\n\n` +
      `<b>Strategy Options</b>\n` + strategyHelp + `\n\n` +
      `<i>Buy/sell uses paper or live mode based on bot config.</i>`
    );
    return;
  }

  // ── Dispatch commands ─────────────────────────────────────────────────────
  switch (cmd) {

    // Info commands
    case "/start":
    case "/help":
      await sendMsg(chatId, fmtHelp());
      break;

    case "/status":
      await sendMsg(chatId, fmtStatus(), MAIN_KB);
      break;

    case "/balance":
      await sendMsg(chatId, fmtBalance());
      break;

    case "/positions":
      await sendMsg(chatId, fmtPositions());
      break;

    case "/performance": {
      const perfArg = (rawText.trim().split(/\s+/)[1] ?? "").toLowerCase();
      if (perfArg === "active-swing") {
        await sendMsg(chatId, fmtActiveSwingPerformance());
      } else if (perfArg === "conservative-scalping") {
        await sendMsg(chatId, fmtCSPerformance());
      } else {
        await sendMsg(chatId, fmtPerformance());
      }
      break;
    }

    case "/tradecount": {
      const tcArg = (rawText.trim().split(/\s+/)[1] ?? "").toLowerCase();
      await sendMsg(chatId, fmtTradeCount(tcArg || undefined));
      break;
    }

    case "/scanner":
      await sendMsg(chatId, fmtScanner());
      break;

    case "/signals":
      await sendMsg(chatId, fmtSignals());
      break;

    case "/health":
      await sendMsg(chatId, fmtHealth());
      break;

    // Control commands
    case "/startbot":
    case "/resume":
      await doStartBot(chatId);
      break;

    case "/stopbot": {
      if (!getBotIsRunning()) {
        await sendMsg(chatId, `ℹ️ Bot is already stopped.`);
        break;
      }
      setPending(userId, "stop bot", async () => {
        await doStopBot(chatId);
        return "";
      });
      await sendMsg(chatId, `⚠️ <b>Confirm stop?</b>\nType /confirm within 60s to stop the bot, or /cancel to abort.`);
      break;
    }

    case "/pause": {
      if (!getBotIsRunning()) {
        await sendMsg(chatId, `ℹ️ Bot is already stopped.`);
        break;
      }
      stop("USER_STOP");
      await sendMsg(chatId, `⏸ <b>Bot paused.</b>\nSend /resume to restart.`);
      break;
    }

    case "/paper": {
      const s = buildStatus();
      if (s.testMode) {
        await sendMsg(chatId, `ℹ️ Already in PAPER mode.`);
        break;
      }
      await doSwitchPaper(chatId);
      break;
    }

    case "/live": {
      const s = buildStatus();
      if (!s.testMode) {
        await sendMsg(chatId, `ℹ️ Already in LIVE mode.`);
        break;
      }
      if (!s.keysReady) {
        await sendMsg(chatId, `❌ Cannot switch to LIVE — API keys not set.`);
        break;
      }
      setPending(userId, "switch to LIVE trading", async () => {
        await doSwitchLive(chatId);
        return "";
      });
      await sendMsg(
        chatId,
        `⚠️ <b>Switch to LIVE trading?</b>\n\nThis will place <b>real orders</b> with real money on Gate.io.\n\nType /confirm within 60s to proceed, or /cancel to abort.`,
      );
      break;
    }

    // Market commands
    case "/scan":
      await doScan(chatId);
      break;

    case "/watchlist":
      await sendMsg(chatId, fmtWatchlist());
      break;

    case "/topmarkets":
      await doTopMarkets(chatId);
      break;

    default:
      if (cmd?.startsWith("/")) {
        await sendMsg(chatId, `❓ Unknown command. Send /help for the full list.`);
      }
  }

  void telegramNotifier; // keep import live for side effects
}
