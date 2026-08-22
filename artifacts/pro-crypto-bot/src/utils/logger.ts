// ─────────────────────────────────────────────────────────────────────────────
// Auto Logger — Persistent in-browser logging + CSV export + performance tracking
// ─────────────────────────────────────────────────────────────────────────────

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR" | "TRADE" | "SIGNAL" | "RISK" | "SYSTEM";

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: LogLevel;
  category: string;
  message: string;
  data?: Record<string, unknown>;
  sessionId: string;
}

export interface TradeLog {
  id: string;
  timestamp: Date;
  symbol: string;
  side: "BUY" | "SELL";
  entryPrice: number;
  exitPrice?: number;
  qty: number;
  usdtAmount: number;
  pnl?: number;
  pnlPercent?: number;
  status: "OPEN" | "CLOSED" | "CANCELLED";
  reason: string;
  exitReason?: "TP" | "SL" | "MANUAL" | "CIRCUIT_BREAK";
  durationMs?: number;
  indicators?: Record<string, number | string>;
  riskScore?: number;
}

export interface PerformanceSnapshot {
  timestamp: Date;
  equity: number;
  dailyPnL: number;
  openPositions: number;
  totalTrades: number;
  winRate: number;
  drawdown: number;
  riskScore: number;
}

const SESSION_ID = `sess-${Date.now()}`;
const LOG_KEY    = "procryptobot_logs";
const TRADE_KEY  = "procryptobot_trades";
const PERF_KEY   = "procryptobot_perf";
const MAX_LOGS   = 2000;
const MAX_TRADES = 500;
const MAX_PERF   = 1440; // 24h of per-minute snapshots

// ── Storage helpers ───────────────────────────────────────────────────────────
function readStorage<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return parsed.map((item: Record<string, unknown>) => ({
      ...item,
      timestamp: new Date(item.timestamp as string),
      ...(item.exitTime ? { exitTime: new Date(item.exitTime as string) } : {}),
    }));
  } catch {
    return [];
  }
}

function writeStorage<T>(key: string, data: T[], maxLen: number): void {
  try {
    localStorage.setItem(key, JSON.stringify(data.slice(0, maxLen)));
  } catch {
    // localStorage quota exceeded — trim and retry
    try {
      localStorage.setItem(key, JSON.stringify(data.slice(0, Math.floor(maxLen / 2))));
    } catch {
      // ignore
    }
  }
}

// ── Logger class ──────────────────────────────────────────────────────────────
class BotLogger {
  private logs: LogEntry[] = [];
  private tradeLogs: TradeLog[] = [];
  private perfSnapshots: PerformanceSnapshot[] = [];

  constructor() {
    this.logs       = readStorage<LogEntry>(LOG_KEY);
    this.tradeLogs  = readStorage<TradeLog>(TRADE_KEY);
    this.perfSnapshots = readStorage<PerformanceSnapshot>(PERF_KEY);
    this.log("SYSTEM", "Logger", "🟢 Bot logger initialized — session: " + SESSION_ID);
  }

  // ── Core log ───────────────────────────────────────────────────────────────
  log(level: LogLevel, category: string, message: string, data?: Record<string, unknown>): LogEntry {
    const entry: LogEntry = {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date(),
      level,
      category,
      message,
      data,
      sessionId: SESSION_ID,
    };
    this.logs = [entry, ...this.logs.slice(0, MAX_LOGS - 1)];
    writeStorage(LOG_KEY, this.logs, MAX_LOGS);
    return entry;
  }

  info  = (cat: string, msg: string, data?: Record<string, unknown>) => this.log("INFO",   cat, msg, data);
  warn  = (cat: string, msg: string, data?: Record<string, unknown>) => this.log("WARN",   cat, msg, data);
  error = (cat: string, msg: string, data?: Record<string, unknown>) => this.log("ERROR",  cat, msg, data);
  trade = (cat: string, msg: string, data?: Record<string, unknown>) => this.log("TRADE",  cat, msg, data);
  signal = (cat: string, msg: string, data?: Record<string, unknown>) => this.log("SIGNAL", cat, msg, data);
  risk  = (cat: string, msg: string, data?: Record<string, unknown>) => this.log("RISK",   cat, msg, data);
  debug = (cat: string, msg: string, data?: Record<string, unknown>) => this.log("DEBUG",  cat, msg, data);

  // ── Trade logging ──────────────────────────────────────────────────────────
  logTradeOpen(trade: Omit<TradeLog, "status">): TradeLog {
    const t: TradeLog = { ...trade, status: "OPEN" };
    this.tradeLogs = [t, ...this.tradeLogs.slice(0, MAX_TRADES - 1)];
    writeStorage(TRADE_KEY, this.tradeLogs, MAX_TRADES);
    this.trade("Trade", `📈 OPEN ${trade.side} ${trade.symbol} @ $${trade.entryPrice.toFixed(4)} — $${trade.usdtAmount.toFixed(2)}`);
    return t;
  }

  logTradeClose(id: string, exitPrice: number, exitReason: TradeLog["exitReason"]): TradeLog | null {
    const idx = this.tradeLogs.findIndex((t) => t.id === id);
    if (idx === -1) return null;
    const t = this.tradeLogs[idx];
    const pnl = t.side === "BUY"
      ? (exitPrice - t.entryPrice) * t.qty
      : (t.entryPrice - exitPrice) * t.qty;
    const pnlPercent = (pnl / t.usdtAmount) * 100;
    const durationMs = Date.now() - t.timestamp.getTime();
    const updated: TradeLog = { ...t, exitPrice, pnl, pnlPercent, status: "CLOSED", exitReason, durationMs };
    this.tradeLogs[idx] = updated;
    writeStorage(TRADE_KEY, this.tradeLogs, MAX_TRADES);
    const emoji = pnl >= 0 ? "✅" : "❌";
    this.trade("Trade", `${emoji} CLOSE ${t.side} ${t.symbol} @ $${exitPrice.toFixed(4)} | P&L: $${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%) | ${exitReason}`);
    return updated;
  }

  // ── Performance snapshot ───────────────────────────────────────────────────
  snapPerformance(snap: PerformanceSnapshot): void {
    this.perfSnapshots = [snap, ...this.perfSnapshots.slice(0, MAX_PERF - 1)];
    writeStorage(PERF_KEY, this.perfSnapshots, MAX_PERF);
  }

  // ── Getters ────────────────────────────────────────────────────────────────
  getLogs(filter?: { level?: LogLevel; category?: string; limit?: number; sessionOnly?: boolean }): LogEntry[] {
    let out = this.logs;
    if (filter?.level)       out = out.filter((l) => l.level === filter.level);
    if (filter?.category)    out = out.filter((l) => l.category === filter.category);
    if (filter?.sessionOnly) out = out.filter((l) => l.sessionId === SESSION_ID);
    return out.slice(0, filter?.limit ?? 500);
  }

  getTradeLogs(status?: TradeLog["status"]): TradeLog[] {
    if (status) return this.tradeLogs.filter((t) => t.status === status);
    return this.tradeLogs;
  }

  getPerfSnapshots(hours = 24): PerformanceSnapshot[] {
    const cutoff = Date.now() - hours * 3_600_000;
    return this.perfSnapshots.filter((s) => s.timestamp.getTime() > cutoff);
  }

  getSessionId(): string { return SESSION_ID; }

  // ── Performance analytics ──────────────────────────────────────────────────
  getStats() {
    const closed = this.tradeLogs.filter((t) => t.status === "CLOSED");
    const wins   = closed.filter((t) => (t.pnl ?? 0) > 0);
    const losses = closed.filter((t) => (t.pnl ?? 0) <= 0);

    const grossWin  = wins.reduce((s, t) => s + (t.pnl ?? 0), 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + (t.pnl ?? 0), 0));

    const winRate     = closed.length ? (wins.length / closed.length) * 100 : 0;
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 999 : 1;
    const avgWin      = wins.length   ? grossWin  / wins.length   : 0;
    const avgLoss     = losses.length ? grossLoss / losses.length : 0;
    const totalPnL    = closed.reduce((s, t) => s + (t.pnl ?? 0), 0);

    // Drawdown from trade sequence
    let peak = 0, maxDD = 0, running = 0;
    for (const t of [...closed].reverse()) {
      running += t.pnl ?? 0;
      if (running > peak) peak = running;
      const dd = peak - running;
      if (dd > maxDD) maxDD = dd;
    }

    const avgDuration = closed.length
      ? closed.reduce((s, t) => s + (t.durationMs ?? 0), 0) / closed.length
      : 0;

    return {
      totalTrades: closed.length,
      openTrades:  this.tradeLogs.filter((t) => t.status === "OPEN").length,
      wins:        wins.length,
      losses:      losses.length,
      winRate:     parseFloat(winRate.toFixed(1)),
      profitFactor: parseFloat(profitFactor.toFixed(2)),
      avgWin:      parseFloat(avgWin.toFixed(2)),
      avgLoss:     parseFloat(avgLoss.toFixed(2)),
      totalPnL:    parseFloat(totalPnL.toFixed(2)),
      maxDrawdown: parseFloat(maxDD.toFixed(2)),
      avgDurationMs: Math.round(avgDuration),
      bestTrade:   wins.length   ? Math.max(...wins.map((t)   => t.pnl ?? 0)) : 0,
      worstTrade:  losses.length ? Math.min(...losses.map((t) => t.pnl ?? 0)) : 0,
    };
  }

  // ── Export ─────────────────────────────────────────────────────────────────
  exportLogsCSV(): void {
    const rows = this.logs.map((l) =>
      [l.timestamp.toISOString(), l.level, l.category, `"${l.message.replace(/"/g, "'")}"`].join(",")
    );
    this.downloadCSV("bot_logs.csv", ["timestamp,level,category,message", ...rows].join("\n"));
  }

  exportTradesCSV(): void {
    const header = "timestamp,symbol,side,entryPrice,exitPrice,qty,usdtAmount,pnl,pnlPercent,status,exitReason,durationMs";
    const rows = this.tradeLogs.map((t) =>
      [
        t.timestamp.toISOString(), t.symbol, t.side,
        t.entryPrice, t.exitPrice ?? "",
        t.qty, t.usdtAmount,
        t.pnl?.toFixed(2) ?? "", t.pnlPercent?.toFixed(2) ?? "",
        t.status, t.exitReason ?? "", t.durationMs ?? "",
      ].join(",")
    );
    this.downloadCSV("trade_history.csv", [header, ...rows].join("\n"));
  }

  private downloadCSV(filename: string, content: string): void {
    const blob = new Blob([content], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  clearLogs(): void {
    this.logs = [];
    localStorage.removeItem(LOG_KEY);
    this.log("SYSTEM", "Logger", "🗑️ Logs cleared by user");
  }

  clearTrades(): void {
    this.tradeLogs = [];
    localStorage.removeItem(TRADE_KEY);
    this.log("SYSTEM", "Logger", "🗑️ Trade history cleared by user");
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────
export const logger = new BotLogger();
