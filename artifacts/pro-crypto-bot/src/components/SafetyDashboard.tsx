// ─────────────────────────────────────────────────────────────────────────────
// SafetyDashboard — VPS system health + account protection + circuit breakers
// Wired to: GET /system-health (new), GET /api/bot/status, real-time polling
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback, useRef } from "react";
import { SERVER_URL } from "../config/urls";
import { RiskState, RiskLimits } from "../utils/riskManager";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SystemHealth {
  cpu:    { usedPct: number; loadAvg1m: number; loadAvg5m: number; loadAvg15m: number; cores: number };
  memory: { totalBytes: number; freeBytes: number; usedBytes: number; usedPct: number };
  disk:   { totalBytes: number; freeBytes: number; usedPct: number } | null;
  serverUptime: number;
  checkedAt: string;
}

interface BotStatus {
  isRunning: boolean;
  uptime:    number;
  risk?: { isHalted: boolean; haltReason: string | null };
}

interface Props {
  riskState:      RiskState;
  limits:         RiskLimits;
  onUpdateLimits: (u: Partial<RiskLimits>) => void;
  isBotRunning:   boolean;
  onStopBot:      () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number, d = 2) { return n.toFixed(d); }

function fmtBytes(b: number) {
  if (b >= 1_073_741_824) return `${(b / 1_073_741_824).toFixed(1)} GB`;
  if (b >= 1_048_576)     return `${(b / 1_048_576).toFixed(0)} MB`;
  return `${(b / 1024).toFixed(0)} KB`;
}

function fmtUptime(s: number) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

function fmtLastRestart(uptimeSecs: number) {
  const ms = Date.now() - uptimeSecs * 1000;
  return new Date(ms).toLocaleString();
}

// ── Sub-components ────────────────────────────────────────────────────────────

function GaugeMeter({
  label, value, unit, warn, danger, barColor,
}: { label: string; value: number; unit: string; warn: number; danger: number; barColor?: string }) {
  const pct   = Math.min(100, value);
  const color = barColor ?? (pct >= danger ? "bg-red-500" : pct >= warn ? "bg-orange-400" : "bg-green-500");
  const textColor = pct >= danger ? "text-red-400" : pct >= warn ? "text-orange-400" : "text-green-400";
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">{label}</span>
        <span className={`text-sm font-bold ${textColor}`}>{fmt(value, 1)}{unit}</span>
      </div>
      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function StatCell({ label, value, sub, color = "text-white" }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-base font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-600 mt-0.5">{sub}</p>}
    </div>
  );
}

function LimitSlider({ label, value, min, max, step, unit, onChange, danger }: {
  label: string; value: number; min: number; max: number; step: number;
  unit: string; onChange: (v: number) => void; danger?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="text-gray-400">{label}</span>
        <span className={`font-bold ${danger ? "text-red-400" : "text-cyan-400"}`}>{value}{unit}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
        style={{ accentColor: danger ? "#ef4444" : "#22d3ee" }}
      />
      <div className="flex justify-between text-xs text-gray-600">
        <span>{min}{unit}</span><span>{max}{unit}</span>
      </div>
    </div>
  );
}

function Skeleton() {
  return <div className="h-20 bg-gray-800/60 rounded-xl animate-pulse" />;
}

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  SAFE:    { color: "text-green-400",  bg: "bg-green-500/10  border-green-500/30",  bar: "bg-green-500" },
  CAUTION: { color: "text-yellow-400", bg: "bg-yellow-500/10 border-yellow-500/30", bar: "bg-yellow-400" },
  WARNING: { color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/30", bar: "bg-orange-400" },
  DANGER:  { color: "text-red-400",    bg: "bg-red-500/10   border-red-500/30",     bar: "bg-red-500" },
  HALTED:  { color: "text-red-300",    bg: "bg-red-900/30   border-red-500/60",     bar: "bg-red-600" },
};

function RiskGauge({ score }: { score: number }) {
  const cfg = score >= 90 ? STATUS_CONFIG.HALTED
            : score >= 70 ? STATUS_CONFIG.DANGER
            : score >= 50 ? STATUS_CONFIG.WARNING
            : score >= 30 ? STATUS_CONFIG.CAUTION
            : STATUS_CONFIG.SAFE;
  const label = score >= 90 ? "HALTED" : score >= 70 ? "DANGER" : score >= 50 ? "WARNING" : score >= 30 ? "CAUTION" : "SAFE";
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-28 h-28">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="#1f2937" strokeWidth="3" />
          <circle
            cx="18" cy="18" r="15.9" fill="none"
            stroke={score >= 70 ? "#ef4444" : score >= 50 ? "#f97316" : score >= 30 ? "#eab308" : "#22c55e"}
            strokeWidth="3"
            strokeDasharray={`${score} ${100 - score}`}
            strokeLinecap="round"
            style={{ transition: "stroke-dasharray 0.6s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-black text-white">{score}</span>
          <span className="text-[13px] font-bold text-gray-400 uppercase tracking-wider">Risk</span>
        </div>
      </div>
      <span className={`text-[13px] font-bold font-bold uppercase tracking-widest ${cfg.color}`}>{label}</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function SafetyDashboard({ riskState, limits, onUpdateLimits, isBotRunning, onStopBot }: Props) {
  const [tab, setTab]       = useState<"overview" | "vps" | "limits" | "alerts" | "sizing">("overview");
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [apiLatency, setApiLatency]   = useState<number | null>(null);
  const [botStatus, setBotStatus]     = useState<BotStatus | null>(null);
  const [loadingHealth, setLoadingHealth] = useState(false);
  const connectionSince = useRef<number>(Date.now());

  const authHeaders = () => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${localStorage.getItem("pcb_jwt") ?? ""}`,
  });

  const loadHealth = useCallback(async () => {
    setLoadingHealth(true);
    try {
      const t0  = performance.now();
      const res = await fetch(`${SERVER_URL}/api/system-health`);
      const latency = Math.round(performance.now() - t0);
      setApiLatency(latency);
      const d = await res.json() as { ok: boolean; data?: SystemHealth };
      if (d.ok && d.data) {
        setHealth(d.data);
        setHealthError(null);
      } else {
        setHealthError("Could not load system health");
      }
    } catch (e) {
      setHealthError(String(e));
    } finally {
      setLoadingHealth(false);
    }
  }, []);

  const loadBotStatus = useCallback(async () => {
    try {
      const res = await fetch(`${SERVER_URL}/api/status`, { headers: authHeaders() });
      const d = await res.json() as { ok: boolean } & BotStatus;
      if (d.ok) setBotStatus(d);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    void loadHealth();
    void loadBotStatus();
    const h  = setInterval(() => void loadHealth(), 10_000);
    const bs = setInterval(() => void loadBotStatus(), 15_000);
    return () => { clearInterval(h); clearInterval(bs); };
  }, [loadHealth, loadBotStatus]);

  const cfg = STATUS_CONFIG[riskState.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.SAFE;
  const wsUptime = Math.floor((Date.now() - connectionSince.current) / 1000);

  return (
    <div className="space-y-4">
      {/* Circuit Breaker Banner */}
      {riskState.circuitBreakerTripped && (
        <div className="flex items-center justify-between gap-4 bg-red-900/40 border-2 border-red-500/60 rounded-xl px-5 py-4 animate-pulse">
          <div>
            <p className="text-red-300 font-black text-sm uppercase tracking-wide">Circuit Breaker Tripped</p>
            <p className="text-red-400/80 text-xs mt-0.5">
              {riskState.alerts[0]?.message ?? "Safety limit exceeded — all trading halted"}
            </p>
          </div>
          {isBotRunning && (
            <button onClick={onStopBot}
              className="shrink-0 bg-red-500 hover:bg-red-600 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors">
              STOP BOT NOW
            </button>
          )}
        </div>
      )}

      {/* Header */}
      <div className={`flex items-center justify-between p-4 rounded-xl border ${cfg.bg}`}>
        <div className="flex items-center gap-4">
          <RiskGauge score={riskState.riskScore} />
          <div>
            <h2 className="text-white font-black text-lg">Account Safety</h2>
            <p className={`text-sm font-semibold ${cfg.color}`}>Status: {riskState.status}</p>
            <p className="text-xs text-gray-500 mt-1">
              Balance: <span className="text-white font-bold">${fmt(riskState.totalBalance)}</span>
              {" · "} Peak: <span className="text-white">${fmt(riskState.peakEquity)}</span>
            </p>
          </div>
        </div>
        <div className="hidden md:grid grid-cols-2 gap-2 text-right">
          <div className={`text-xs px-3 py-1.5 rounded-lg font-semibold ${riskState.dailyPnL >= 0 ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
            Daily P&L: ${fmt(riskState.dailyPnL)} ({fmt(riskState.dailyPnLPercent)}%)
          </div>
          <div className={`text-xs px-3 py-1.5 rounded-lg font-semibold ${riskState.drawdown < 5 ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
            Drawdown: {fmt(riskState.drawdown)}%
          </div>
          <div className="text-xs px-3 py-1.5 rounded-lg bg-gray-800 text-gray-300">
            Open: {riskState.openPositions}/{limits.maxOpenPositions} positions
          </div>
          <div className={`text-xs px-3 py-1.5 rounded-lg font-semibold ${riskState.consecutiveLosses >= 3 ? "bg-orange-500/10 text-orange-400" : "bg-gray-800 text-gray-300"}`}>
            Loss streak: {riskState.consecutiveLosses}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-900 rounded-xl p-1 flex-wrap">
        {(["overview","vps","limits","alerts","sizing"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 min-w-fit text-sm font-semibold py-2 rounded-lg capitalize transition-all ${
              tab === t ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30" : "text-gray-500 hover:text-gray-300"
            }`}>
            {t === "overview" ? "Overview"
             : t === "vps"     ? "VPS Health"
             : t === "limits"  ? "Limits"
             : t === "alerts"  ? `Alerts (${riskState.alerts.length})`
             : "Sizing"}
          </button>
        ))}
      </div>

      {/* ── Overview Tab ──────────────────────────────────────────────────── */}
      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCell label="Win Rate" value={`${fmt(riskState.winRate, 1)}%`}
              sub={`${riskState.winningTrades}W / ${riskState.totalTrades - riskState.winningTrades}L`}
              color={riskState.winRate >= 50 ? "text-green-400" : "text-red-400"} />
            <StatCell label="Profit Factor" value={fmt(riskState.profitFactor)}
              sub="Gross Win / Gross Loss"
              color={riskState.profitFactor >= 1.5 ? "text-green-400" : riskState.profitFactor >= 1 ? "text-yellow-400" : "text-red-400"} />
            <StatCell label="Sharpe Ratio" value={fmt(riskState.sharpeRatio)}
              sub="Risk-adjusted return"
              color={riskState.sharpeRatio >= 1 ? "text-green-400" : riskState.sharpeRatio >= 0 ? "text-yellow-400" : "text-red-400"} />
            <StatCell label="Max Drawdown" value={`${fmt(riskState.maxDrawdown)}%`}
              sub={`Limit: ${limits.maxDrawdownPercent}%`}
              color={riskState.maxDrawdown < limits.maxDrawdownPercent / 2 ? "text-green-400" : "text-red-400"} />
            <StatCell label="Avg Win" value={`$${fmt(riskState.avgWin)}`} color="text-green-400" />
            <StatCell label="Avg Loss" value={`$${fmt(riskState.avgLoss)}`} color="text-red-400" />
            <StatCell label="Total Trades" value={`${riskState.totalTrades}`} sub={`${riskState.openPositions} open`} />
            <StatCell label="Daily P&L"
              value={`${riskState.dailyPnL >= 0 ? "+" : ""}$${fmt(riskState.dailyPnL)}`}
              sub={`${fmt(riskState.dailyPnLPercent)}% · Limit: -${limits.maxDailyLossPercent}%`}
              color={riskState.dailyPnL >= 0 ? "text-green-400" : "text-red-400"} />
          </div>

          {/* Live Risk Gauges */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
            <h3 className="text-white font-semibold text-sm">Live Risk Gauges</h3>
            {[
              { label: "Daily Loss",  val: Math.abs(Math.min(0, riskState.dailyPnLPercent)), limit: limits.maxDailyLossPercent, unit: "%" },
              { label: "Drawdown",    val: riskState.drawdown,           limit: limits.maxDrawdownPercent,  unit: "%" },
              { label: "Positions",   val: riskState.openPositions,      limit: limits.maxOpenPositions,    unit: "" },
              { label: "Loss Streak", val: riskState.consecutiveLosses,  limit: limits.maxConsecutiveLosses,unit: "" },
            ].map(({ label, val, limit, unit }) => {
              const pct   = Math.min(100, (val / limit) * 100);
              const color = pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-orange-400" : pct >= 50 ? "bg-yellow-400" : "bg-green-500";
              return (
                <div key={label}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-400">{label}</span>
                    <span className="text-white">{fmt(val, 1)}{unit} / {limit}{unit}</span>
                  </div>
                  <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Circuit Breaker Rules */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <h3 className="text-white font-semibold text-sm mb-3">Circuit Breaker Rules</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {[
                { rule: "Max Daily Loss",          check: riskState.dailyPnLPercent > -limits.maxDailyLossPercent,   detail: `>${limits.maxDailyLossPercent}% day loss -> halt` },
                { rule: "Max Drawdown",             check: riskState.drawdown < limits.maxDrawdownPercent,            detail: `>${limits.maxDrawdownPercent}% from peak -> halt` },
                { rule: "Consecutive Losses",       check: riskState.consecutiveLosses < limits.maxConsecutiveLosses, detail: `${limits.maxConsecutiveLosses}+ losses -> cool down` },
                { rule: "Max Open Positions",       check: riskState.openPositions < limits.maxOpenPositions,         detail: `>${limits.maxOpenPositions} trades -> block new` },
                { rule: "Weekly Loss Limit",        check: riskState.weeklyPnL > -(riskState.totalBalance * limits.maxWeeklyLossPercent / 100), detail: `>${limits.maxWeeklyLossPercent}% weekly -> halt` },
                { rule: "Min Win Rate (>=10 trades)", check: riskState.totalTrades < 10 || riskState.winRate >= limits.minWinRatePercent, detail: `<${limits.minWinRatePercent}% win rate -> warn` },
              ].map(({ rule, check, detail }) => (
                <div key={rule} className="flex items-start gap-2 bg-gray-800/50 rounded-lg p-2.5">
                  <span className={`text-sm mt-0.5 font-bold ${check ? "text-green-400" : "text-red-400"}`}>{check ? "+" : "x"}</span>
                  <div>
                    <p className="text-xs text-white font-medium">{rule}</p>
                    <p className="text-xs text-gray-500">{detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── VPS Health Tab ────────────────────────────────────────────────── */}
      {tab === "vps" && (
        <div className="space-y-4">
          {healthError && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">{healthError}</div>
          )}

          {loadingHealth && !health && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} />)}
            </div>
          )}

          {health && (
            <>
              {/* Key metrics grid */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
                  <p className="text-xs text-gray-400 mb-1">Server Uptime (OS)</p>
                  <p className="text-base font-bold text-cyan-400">{fmtUptime(health.serverUptime)}</p>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
                  <p className="text-xs text-gray-400 mb-1">Last Restart</p>
                  <p className="text-sm font-bold text-white">{fmtLastRestart(health.serverUptime)}</p>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
                  <p className="text-xs text-gray-400 mb-1">Bot Uptime</p>
                  <p className="text-base font-bold text-green-400">
                    {botStatus?.isRunning && botStatus.uptime ? fmtUptime(botStatus.uptime) : "Not running"}
                  </p>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
                  <p className="text-xs text-gray-400 mb-1">API Latency</p>
                  <p className={`text-base font-bold ${apiLatency != null && apiLatency < 150 ? "text-green-400" : apiLatency != null && apiLatency < 400 ? "text-yellow-400" : "text-red-400"}`}>
                    {apiLatency != null ? `${apiLatency} ms` : "—"}
                  </p>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
                  <p className="text-xs text-gray-400 mb-1">Page Session</p>
                  <p className="text-base font-bold text-purple-400">{fmtUptime(wsUptime)}</p>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
                  <p className="text-xs text-gray-400 mb-1">CPU Cores</p>
                  <p className="text-base font-bold text-white">{health.cpu.cores}</p>
                </div>
              </div>

              {/* CPU */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
                <h3 className="text-white font-semibold text-sm">CPU Load</h3>
                <GaugeMeter label="CPU Used" value={health.cpu.usedPct} unit="%" warn={60} danger={85} />
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: "Load 1m",  v: health.cpu.loadAvg1m  },
                    { label: "Load 5m",  v: health.cpu.loadAvg5m  },
                    { label: "Load 15m", v: health.cpu.loadAvg15m },
                  ].map(({ label, v }) => (
                    <div key={label} className="bg-gray-800/50 rounded-lg p-2 text-center">
                      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
                      <p className={`text-xs font-bold ${v >= health.cpu.cores ? "text-red-400" : v >= health.cpu.cores * 0.7 ? "text-yellow-400" : "text-green-400"}`}>{v}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* RAM */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
                <h3 className="text-white font-semibold text-sm">Memory (RAM)</h3>
                <GaugeMeter label="RAM Used" value={health.memory.usedPct} unit="%" warn={70} danger={90} />
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: "Total", v: fmtBytes(health.memory.totalBytes) },
                    { label: "Used",  v: fmtBytes(health.memory.usedBytes) },
                    { label: "Free",  v: fmtBytes(health.memory.freeBytes) },
                  ].map(({ label, v }) => (
                    <div key={label} className="bg-gray-800/50 rounded-lg p-2 text-center">
                      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
                      <p className="text-xs font-bold text-white">{v}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Disk */}
              {health.disk ? (
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
                  <h3 className="text-white font-semibold text-sm">Disk Usage</h3>
                  <GaugeMeter label="Disk Used" value={health.disk.usedPct} unit="%" warn={75} danger={90} />
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: "Total", v: fmtBytes(health.disk.totalBytes) },
                      { label: "Free",  v: fmtBytes(health.disk.freeBytes) },
                      { label: "Used",  v: `${fmt(health.disk.usedPct, 1)}%` },
                    ].map(({ label, v }) => (
                      <div key={label} className="bg-gray-800/50 rounded-lg p-2 text-center">
                        <p className="text-xs text-gray-500 mb-0.5">{label}</p>
                        <p className="text-xs font-bold text-white">{v}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center text-gray-500 text-sm">
                  Disk usage — coming soon (statfs not supported on this runtime)
                </div>
              )}

              <p className="text-xs text-gray-600 text-center">
                Updated: {new Date(health.checkedAt).toLocaleTimeString()} · Polls every 10s
              </p>
            </>
          )}
        </div>
      )}

      {/* ── Limits Tab ────────────────────────────────────────────────────── */}
      {tab === "limits" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-gray-900 border border-red-500/20 rounded-xl p-5 space-y-5">
            <h3 className="text-white font-semibold text-sm">Stop-Loss Rules</h3>
            <LimitSlider label="Max Daily Loss"   value={limits.maxDailyLossPercent}  min={0.5} max={10} step={0.5} unit="%" onChange={(v) => onUpdateLimits({ maxDailyLossPercent: v })}  danger />
            <LimitSlider label="Max Drawdown"     value={limits.maxDrawdownPercent}   min={2}   max={30} step={1}   unit="%" onChange={(v) => onUpdateLimits({ maxDrawdownPercent: v })}   danger />
            <LimitSlider label="Max Weekly Loss"  value={limits.maxWeeklyLossPercent} min={1}   max={20} step={0.5} unit="%" onChange={(v) => onUpdateLimits({ maxWeeklyLossPercent: v })} danger />
            <LimitSlider label="Consecutive Losses Limit" value={limits.maxConsecutiveLosses} min={2} max={10} step={1} unit="" onChange={(v) => onUpdateLimits({ maxConsecutiveLosses: v })} danger />
          </div>
          <div className="bg-gray-900 border border-cyan-500/20 rounded-xl p-5 space-y-5">
            <h3 className="text-white font-semibold text-sm">Position Limits</h3>
            <LimitSlider label="Max Open Positions"    value={limits.maxOpenPositions}       min={1}   max={20}  step={1}   unit=""  onChange={(v) => onUpdateLimits({ maxOpenPositions: v })} />
            <LimitSlider label="Max Position Size"     value={limits.maxPositionSizePercent} min={0.5} max={10}  step={0.5} unit="%" onChange={(v) => onUpdateLimits({ maxPositionSizePercent: v })} />
            <LimitSlider label="Max Single Trade Risk" value={limits.maxSingleTradeRisk}     min={0.1} max={5}   step={0.1} unit="%" onChange={(v) => onUpdateLimits({ maxSingleTradeRisk: v })} />
            <LimitSlider label="Min Win Rate (warning)"value={limits.minWinRatePercent}      min={10}  max={70}  step={5}   unit="%" onChange={(v) => onUpdateLimits({ minWinRatePercent: v })} />
            <LimitSlider label="Cooldown After Break"  value={limits.cooldownMinutes}        min={5}   max={240} step={5}   unit="min" onChange={(v) => onUpdateLimits({ cooldownMinutes: v })} />
          </div>
          <div className="md:col-span-2 bg-gray-900 border border-yellow-500/20 rounded-xl p-4">
            <h3 className="text-yellow-400 font-semibold text-sm mb-3">Safety Best Practices</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-gray-400">
              {[
                ["1% Risk Rule", "Never risk more than 1% of account per trade."],
                ["3% Daily Stop", "A 3% daily loss limit means 3.09% needed to recover."],
                ["Kelly Criterion", "Use 50% Kelly sizing. Full Kelly causes 50% drawdowns."],
                ["Circuit Breakers", "4 consecutive losses = mandatory cooldown."],
                ["Drawdown Math", "10% drawdown needs 11.1% gain. 25% needs 33.3%."],
                ["Win Rate vs R:R", "40% win rate with 2:1 R:R beats 60% with 1:1."],
              ].map(([title, desc]) => (
                <div key={title as string} className="bg-gray-800/60 rounded-lg p-3">
                  <p className="text-white font-medium mb-1">{title}</p>
                  <p>{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Alerts Tab ────────────────────────────────────────────────────── */}
      {tab === "alerts" && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-white font-semibold text-sm">Risk Alerts</h3>
            <span className="text-xs text-gray-500">{riskState.alerts.length} alerts</span>
          </div>
          {riskState.alerts.length === 0 ? (
            <div className="text-center py-8 text-gray-600">
              <p className="text-sm mt-2">No alerts — account is safe</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {riskState.alerts.map((a) => {
                const colorMap: Record<string, string> = {
                  INFO:     "bg-blue-500/10   border-blue-500/20   text-blue-300",
                  WARN:     "bg-yellow-500/10 border-yellow-500/20 text-yellow-300",
                  DANGER:   "bg-orange-500/10 border-orange-500/20 text-orange-300",
                  CRITICAL: "bg-red-500/15    border-red-500/30    text-red-300",
                };
                return (
                  <div key={a.id} className={`flex gap-3 p-3 rounded-lg border text-xs ${colorMap[a.level] ?? colorMap["INFO"]}`}>
                    <div className="flex-1">
                      <div className="flex justify-between">
                        <span className="font-semibold">[{a.level}] {a.rule}</span>
                        <span className="text-gray-500">{a.timestamp.toLocaleTimeString()}</span>
                      </div>
                      <p className="mt-0.5 opacity-80">{a.message}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Sizing Tab ────────────────────────────────────────────────────── */}
      {tab === "sizing" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
              <h3 className="text-white font-semibold text-sm">Position Sizing Methods</h3>
              {[
                {
                  method: "Fixed Risk (1%)",
                  desc:    "Risk exactly 1% of account per trade",
                  formula: "USDT = Balance x Risk%",
                  example: `$${((riskState.availableBalance * limits.maxSingleTradeRisk) / 100).toFixed(2)} USDT`,
                  color:   "text-cyan-400",
                },
                {
                  method: "Half Kelly",
                  desc:    "Mathematically optimal, capped at 50%",
                  formula: "f = (b*p - q) / b * 0.5",
                  example: riskState.winRate > 0 && riskState.avgLoss > 0
                    ? (() => {
                        const b = riskState.avgWin / (riskState.avgLoss || 1);
                        const p = riskState.winRate / 100;
                        const kelly = Math.max(0, (b * p - (1 - p)) / b);
                        return `$${(riskState.availableBalance * kelly * 0.5).toFixed(2)} USDT`;
                      })()
                    : "Need >=1 closed trade",
                  color: "text-purple-400",
                },
                {
                  method: "Max Position Cap",
                  desc:    `Hard cap at ${limits.maxPositionSizePercent}% of account`,
                  formula: "USDT = Balance x MaxPos%",
                  example: `$${((riskState.availableBalance * limits.maxPositionSizePercent) / 100).toFixed(2)} USDT`,
                  color:   "text-yellow-400",
                },
              ].map(({ method, desc, formula, example, color }) => (
                <div key={method} className="bg-gray-800/60 rounded-lg p-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className={`text-xs font-bold ${color}`}>{method}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
                      <p className="text-xs text-gray-600 mt-1">{formula}</p>
                    </div>
                    <span className={`text-xs font-bold ${color}`}>{example}</span>
                  </div>
                </div>
              ))}
              <div className="bg-cyan-500/5 border border-cyan-500/20 rounded-lg p-3 text-xs text-cyan-300/70">
                Bot uses the smallest of all three methods — most conservative wins.
              </div>
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
              <h3 className="text-white font-semibold text-sm">Account Health</h3>
              <div className="space-y-2">
                {[
                  { label: "Available Balance", value: `$${fmt(riskState.availableBalance)}`,   color: "text-green-400" },
                  { label: "Used Margin",        value: `$${fmt(riskState.usedMargin)}`,         color: "text-yellow-400" },
                  { label: "Peak Equity",        value: `$${fmt(riskState.peakEquity)}`,         color: "text-cyan-400" },
                  { label: "Current Drawdown",   value: `${fmt(riskState.drawdown)}%`,           color: riskState.drawdown > 5 ? "text-red-400" : "text-green-400" },
                  { label: "Win Rate",           value: `${fmt(riskState.winRate, 1)}%`,          color: riskState.winRate >= 50 ? "text-green-400" : "text-yellow-400" },
                  { label: "Avg Win / Avg Loss", value: `$${fmt(riskState.avgWin)} / $${fmt(riskState.avgLoss)}`, color: riskState.avgWin > riskState.avgLoss ? "text-green-400" : "text-red-400" },
                  { label: "Profit Factor",      value: fmt(riskState.profitFactor),             color: riskState.profitFactor >= 1.5 ? "text-green-400" : "text-yellow-400" },
                  { label: "Sharpe Ratio",       value: fmt(riskState.sharpeRatio),              color: riskState.sharpeRatio >= 1 ? "text-green-400" : "text-yellow-400" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="flex justify-between text-xs border-b border-gray-800/50 pb-1.5">
                    <span className="text-gray-500">{label}</span>
                    <span className={`font-bold ${color}`}>{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
