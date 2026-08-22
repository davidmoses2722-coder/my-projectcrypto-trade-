import { useState, useEffect, useRef } from "react";
import type { AdvancedRiskStatus, AdvancedRiskConfig } from "../hooks/useBotServer";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RiskTimelineEntry {
  id: number;
  ts: string;
  level: string;
  msg: string;
  source: "sse" | "db";
}

interface DbRiskEvent {
  id?: number;
  createdAt?: string;
  eventType?: string;
  reason?: string;
  meta?: unknown;
}

export interface AdvancedRiskPanelProps {
  advancedRisk?: AdvancedRiskStatus;
  onUpdateConfig: (patch: Partial<AdvancedRiskConfig>) => Promise<unknown>;
  onClearHalt: () => Promise<unknown>;
  onClearCooldown: () => Promise<unknown>;
  onResetDailyPnl: () => Promise<unknown>;
  onResetLossStreak: () => Promise<unknown>;
  onFetchRiskEvents: (limit?: number) => Promise<unknown>;
  serverUrl: string;
  disabled: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const RISK_KEYWORDS = ["[Risk", "[Volatility", "[Portfolio", "[Drawdown"];
function isRiskLog(msg: string): boolean {
  return RISK_KEYWORDS.some((k) => msg.includes(k));
}

function fmtMs(ms: number): string {
  if (ms <= 0) return "0s";
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function pnlColor(v: number): string {
  if (v > 0) return "text-green-400";
  if (v < 0) return "text-red-400";
  return "text-gray-500";
}

function pnlSign(v: number): string {
  return v >= 0 ? "+" : "";
}

const STATE_DISPLAY = {
  ACTIVE:   { bg: "bg-green-500/10",  border: "border-green-500/30",  text: "text-green-400",  dot: "bg-green-400",  icon: "✅", pulse: true  },
  WARNING:  { bg: "bg-yellow-500/10", border: "border-yellow-500/30", text: "text-yellow-400", dot: "bg-yellow-400", icon: "⚠️", pulse: true  },
  COOLDOWN: { bg: "bg-orange-500/10", border: "border-orange-500/30", text: "text-orange-400", dot: "bg-orange-400", icon: "⏳", pulse: true  },
  HALTED:   { bg: "bg-red-500/10",    border: "border-red-500/40",    text: "text-red-400",    dot: "bg-red-500",    icon: "⛔", pulse: false },
} as const;

const LEVEL_STYLE: Record<string, string> = {
  warn:  "text-yellow-400",
  error: "text-red-400",
  info:  "text-blue-400",
};

// ─── Filter categories ────────────────────────────────────────────────────────

const LOG_FILTERS = [
  { key: "all",       label: "All",       match: () => true },
  { key: "risk",      label: "Risk",      match: (m: string) => /\[Risk|\[Volatility|\[Drawdown|\[Portfolio/i.test(m) },
  { key: "signals",   label: "Signals",   match: (m: string) => /\[Signal|\[Strategy|\[Scanner/i.test(m) },
  { key: "execution", label: "Execution", match: (m: string) => /\[Trade|\[Order|\[Exec|\[Fill/i.test(m) },
  { key: "lifecycle", label: "Lifecycle", match: (m: string) => /\[Position|\[Lifecycle|\[TP|\[SL|\[Trail|\[Breakeven/i.test(m) },
  { key: "telegram",  label: "Telegram",  match: (m: string) => /\[Telegram/i.test(m) },
  { key: "config",    label: "Config",    match: (m: string) => /\[Config|\[Param|\[Settings/i.test(m) },
  { key: "errors",    label: "Errors",    match: (_: string, lvl: string) => lvl === "error" || lvl === "warn" },
] as const;
type FilterKey = typeof LOG_FILTERS[number]["key"];

// ─── RiskConsole component ────────────────────────────────────────────────────

function RiskConsole({
  timeline,
  sseConnected,
  onClear,
}: {
  timeline: RiskTimelineEntry[];
  sseConnected: boolean;
  onClear: () => void;
}) {
  const [filter,     setFilter]     = useState<FilterKey>("all");
  const [search,     setSearch]     = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new entries
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [timeline.length, autoScroll]);

  const activeFilter = LOG_FILTERS.find((f) => f.key === filter)!;

  const visible = timeline.filter((e) => {
    if (!activeFilter.match(e.msg, e.level)) return false;
    if (search && !e.msg.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const handleDownload = () => {
    const text = visible
      .map((e) => `[${e.ts}] [${e.level.toUpperCase()}] ${e.source === "sse" ? "●" : " "} ${e.msg}`)
      .join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement("a"), { href: url, download: "risk-console.txt" });
    a.click();
    URL.revokeObjectURL(url);
  };

  const ENTRY_COLORS: Record<string, string> = {
    error: "bg-red-500/8 border-red-500/20 text-red-300",
    warn:  "bg-yellow-500/8 border-yellow-500/20 text-yellow-300",
    info:  "bg-gray-800/40 border-gray-700/20 text-gray-400",
  };

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
      {/* Header bar */}
      <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <p className="text-white font-bold text-sm">📡 Risk Console</p>
          {sseConnected && (
            <span className="text-xs text-green-500 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />
              Live
            </span>
          )}
          <span className="text-gray-600 text-xs">{visible.length} entries</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setAutoScroll((v) => !v)}
            className={`px-2 py-1 rounded text-[10px] font-semibold border transition-all ${
              autoScroll
                ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-400"
                : "bg-gray-800 border-gray-700 text-gray-500"
            }`}
          >
            {autoScroll ? "↑ Auto" : "○ Auto"}
          </button>
          <button
            onClick={handleDownload}
            className="px-2 py-1 rounded text-[10px] font-semibold bg-gray-800 border border-gray-700 text-gray-400 hover:text-gray-300 transition-all"
          >
            ↓ Export
          </button>
          <button
            onClick={onClear}
            className="px-2 py-1 rounded text-[10px] font-semibold bg-gray-800 border border-gray-700 text-gray-400 hover:text-rose-400 transition-all"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-px bg-gray-800/60 overflow-x-auto">
        {LOG_FILTERS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-3 py-1.5 text-[10px] font-bold shrink-0 uppercase tracking-wider transition-colors ${
              filter === key
                ? "bg-gray-900 text-cyan-400 border-b-2 border-cyan-500"
                : "text-gray-600 hover:text-gray-400"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Search box */}
      <div className="px-3 py-2 border-b border-gray-800/60">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search log messages…"
          className="w-full bg-gray-800/60 border border-gray-700/50 rounded-lg px-3 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-cyan-500/50 transition-colors"
        />
      </div>

      {/* Log entries */}
      {visible.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-4xl mb-2">📭</p>
          <p className="text-gray-600 text-sm">{search ? "No matches" : "No risk events yet"}</p>
          <p className="text-gray-700 text-xs mt-1">
            {search ? `Clear search to see all ${timeline.length} entries` : "Events appear here live as the engine logs them"}
          </p>
        </div>
      ) : (
        <div ref={scrollRef} className="space-y-px max-h-72 overflow-y-auto font-mono">
          {visible.map((entry) => (
            <div
              key={entry.id}
              className={`flex gap-2 px-3 py-1.5 text-xs border-l-2 ${
                ENTRY_COLORS[entry.level] ?? ENTRY_COLORS.info
              } ${entry.level === "error" ? "border-l-red-500" : entry.level === "warn" ? "border-l-yellow-500" : "border-l-transparent"}`}
            >
              <span className="text-gray-600 shrink-0 tabular-nums text-[10px] pt-px">
                {new Date(entry.ts).toLocaleTimeString("en", { hour12: false })}
              </span>
              <span className={`shrink-0 text-[10px] font-black uppercase w-7 pt-px ${LEVEL_STYLE[entry.level] ?? "text-gray-500"}`}>
                {entry.level.slice(0, 3)}
              </span>
              {entry.source === "sse" && (
                <span className="shrink-0 text-[10px] text-green-600 font-bold pt-px">●</span>
              )}
              <span className="text-gray-400 break-all leading-relaxed">{entry.msg}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Spinner() {
  return (
    <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin inline-block shrink-0" />
  );
}

function MetricCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-700/50">
      <div className="text-gray-500 text-[13px] font-bold uppercase tracking-wider mb-1">{label}</div>
      <div className={`font-bold text-sm ${color ?? "text-white"}`}>{value}</div>
      {sub && <div className="text-gray-600 text-xs mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

// ─── Config Editor ────────────────────────────────────────────────────────────

function ConfigEditor({
  config,
  onSave,
  disabled,
}: {
  config: AdvancedRiskConfig | undefined;
  onSave: (patch: Partial<AdvancedRiskConfig>) => Promise<unknown>;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState<AdvancedRiskConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);

  useEffect(() => {
    if (config && !draft) setDraft({ ...config });
  }, [config, draft]);

  if (!draft) {
    return <p className="text-gray-600 text-xs p-4">Waiting for config from server…</p>;
  }

  const handleSave = async () => {
    setSaving(true);
    await onSave(draft);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const inp = "w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500 transition-colors";
  const lbl = "text-gray-400 text-sm font-medium mb-1 block";
  const hint = "text-gray-600 text-xs mt-0.5";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">

        <div>
          <label className={lbl}>Max Drawdown %</label>
          <input
            type="number" step="0.5" min="1" max="99" className={inp}
            value={+(draft.maxDrawdownPct * 100).toFixed(1)}
            onChange={(e) =>
              setDraft((d) => d ? { ...d, maxDrawdownPct: (parseFloat(e.target.value) || 20) / 100 } : d)
            }
          />
          <p className={hint}>% drawdown from equity peak</p>
        </div>

        <div>
          <label className={lbl}>Daily Loss Limit ($)</label>
          <input
            type="number" step="5" className={inp}
            value={draft.dailyLossLimitUsd}
            onChange={(e) =>
              setDraft((d) => d ? { ...d, dailyLossLimitUsd: parseFloat(e.target.value) || -100 } : d)
            }
          />
          <p className={hint}>negative, e.g. -100</p>
        </div>

        <div>
          <label className={lbl}>Weekly Loss Limit ($)</label>
          <input
            type="number" step="10" className={inp}
            value={draft.weeklyLossLimitUsd}
            onChange={(e) =>
              setDraft((d) => d ? { ...d, weeklyLossLimitUsd: parseFloat(e.target.value) || -300 } : d)
            }
          />
          <p className={hint}>negative, e.g. -300</p>
        </div>

        <div>
          <label className={lbl}>Monthly Loss Limit ($)</label>
          <input
            type="number" step="25" className={inp}
            value={draft.monthlyLossLimitUsd}
            onChange={(e) =>
              setDraft((d) => d ? { ...d, monthlyLossLimitUsd: parseFloat(e.target.value) || -800 } : d)
            }
          />
          <p className={hint}>negative, e.g. -800</p>
        </div>

        <div>
          <label className={lbl}>Consecutive Loss Limit</label>
          <input
            type="number" step="1" min="1" max="20" className={inp}
            value={draft.consecutiveLossLimit}
            onChange={(e) =>
              setDraft((d) => d ? { ...d, consecutiveLossLimit: parseInt(e.target.value) || 3 } : d)
            }
          />
          <p className={hint}>losses before cooldown</p>
        </div>

        <div>
          <label className={lbl}>Cooldown Duration (s)</label>
          <input
            type="number" step="30" min="30" className={inp}
            value={Math.round(draft.cooldownAfterLossMs / 1000)}
            onChange={(e) =>
              setDraft((d) => d ? { ...d, cooldownAfterLossMs: (parseInt(e.target.value) || 300) * 1000 } : d)
            }
          />
          <p className={hint}>seconds after loss streak</p>
        </div>

        <div>
          <label className={lbl}>Max Concurrent Losses</label>
          <input
            type="number" step="1" min="1" max="10" className={inp}
            value={draft.maxConcurrentLosses}
            onChange={(e) =>
              setDraft((d) => d ? { ...d, maxConcurrentLosses: parseInt(e.target.value) || 2 } : d)
            }
          />
          <p className={hint}>open losing positions cap</p>
        </div>

        <div>
          <label className={lbl}>Volatility ATR Multiple</label>
          <input
            type="number" step="0.1" min="1" className={inp}
            value={draft.volatilityAtrMultiple}
            onChange={(e) =>
              setDraft((d) => d ? { ...d, volatilityAtrMultiple: parseFloat(e.target.value) || 3 } : d)
            }
          />
          <p className={hint}>ATR spike block threshold</p>
        </div>

        <div>
          <label className={lbl}>Volatility Kill Switch</label>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setDraft((d) => d ? { ...d, volatilityKillSwitch: !d.volatilityKillSwitch } : d)}
            className={`w-full py-2 rounded-lg border font-bold text-sm transition-colors ${
              draft.volatilityKillSwitch
                ? "bg-orange-500/20 border-orange-500/40 text-orange-400 hover:bg-orange-500/30"
                : "bg-gray-800 border-gray-700 text-gray-500 hover:border-gray-600"
            } disabled:opacity-40`}
          >
            {draft.volatilityKillSwitch ? "✅ Enabled" : "⭕ Disabled"}
          </button>
          <p className={hint}>block trades on ATR spike</p>
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={saving || disabled}
        className="w-full py-2.5 rounded-xl bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-bold text-sm transition-colors flex items-center justify-center gap-2"
      >
        {saving ? <><Spinner /> Saving…</> : saved ? "✅ Saved!" : "💾 Save Advanced Risk Config"}
      </button>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AdvancedRiskPanel({
  advancedRisk,
  onUpdateConfig,
  onClearHalt,
  onClearCooldown,
  onResetDailyPnl,
  onResetLossStreak,
  onFetchRiskEvents,
  serverUrl,
  disabled,
}: AdvancedRiskPanelProps) {
  const [clearingHalt,    setClearingHalt]    = useState(false);
  const [clearingCooldown,setClearingCooldown]= useState(false);
  const [resettingPnl,   setResettingPnl]    = useState(false);
  const [resettingStreak,setResettingStreak]  = useState(false);
  const [showHaltConfirm,setShowHaltConfirm]  = useState(false);
  const [showConfig,     setShowConfig]       = useState(false);
  const [timeline,       setTimeline]         = useState<RiskTimelineEntry[]>([]);
  const [sseConnected,   setSseConnected]     = useState(false);

  const idRef = useRef(0);
  const esRef = useRef<EventSource | null>(null);

  // Load initial DB risk events
  useEffect(() => {
    void onFetchRiskEvents(40).then((res) => {
      const r = res as { ok: boolean; events?: DbRiskEvent[] };
      if (r.ok && Array.isArray(r.events)) {
        const entries: RiskTimelineEntry[] = r.events.map((e) => ({
          id:     idRef.current++,
          ts:     e.createdAt ?? new Date().toISOString(),
          level:  (e.eventType ?? "").toLowerCase().includes("halt") ? "warn" : "info",
          msg:    `[${e.eventType ?? "EVENT"}] ${e.reason ?? ""}`,
          source: "db",
        }));
        setTimeline(entries.slice(0, 40));
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // SSE — subscribe to bot log stream and filter for risk events
  useEffect(() => {
    const url = `${serverUrl}/api/bot/logs/stream`;
    try {
      const es = new EventSource(url);
      esRef.current = es;

      es.onopen  = () => setSseConnected(true);
      es.onerror = () => setSseConnected(false);

      es.onmessage = (evt) => {
        try {
          const parsed = JSON.parse(evt.data as string) as {
            type: string;
            entry?: { ts: string; level: string; msg: string };
          };
          if (parsed.type === "log" && parsed.entry) {
            const { ts, level, msg } = parsed.entry;
            if (isRiskLog(msg)) {
              setTimeline((prev) => [
                { id: idRef.current++, ts, level, msg, source: "sse" },
                ...prev.slice(0, 49),
              ]);
            }
          }
        } catch { /* ignore parse errors */ }
      };
    } catch { /* SSE not available in this environment */ }

    return () => {
      esRef.current?.close();
      esRef.current = null;
      setSseConnected(false);
    };
  }, [serverUrl]);

  // ── Action handlers ──────────────────────────────────────────────────────
  const handleClearHalt = async () => {
    setShowHaltConfirm(false);
    setClearingHalt(true);
    await onClearHalt();
    setClearingHalt(false);
  };

  const handleClearCooldown = async () => {
    setClearingCooldown(true);
    await onClearCooldown();
    setClearingCooldown(false);
  };

  const handleResetPnl = async () => {
    setResettingPnl(true);
    await onResetDailyPnl();
    setResettingPnl(false);
  };

  const handleResetStreak = async () => {
    setResettingStreak(true);
    await onResetLossStreak();
    setResettingStreak(false);
  };

  // ── Derived display values ───────────────────────────────────────────────
  const ar    = advancedRisk;
  const state = (ar?.state ?? "ACTIVE") as keyof typeof STATE_DISPLAY;
  const s     = STATE_DISPLAY[state] ?? STATE_DISPLAY.ACTIVE;

  return (
    <div className="space-y-4">

      {/* ── 1. Status Banner ────────────────────────────────────────────────── */}
      <div className={`rounded-xl p-4 border ${s.bg} ${s.border}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className={`w-3 h-3 rounded-full shrink-0 ${s.dot} ${s.pulse ? "animate-pulse" : ""}`} />
            <div>
              <p className={`font-bold text-base ${s.text}`}>
                {s.icon} Advanced Risk Engine — {state}
              </p>
              {ar?.haltReason && (
                <p className="text-red-400/80 text-xs mt-0.5">{ar.haltReason}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {ar?.volatilityBlocked && (
              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-yellow-500/20 border border-yellow-500/30 text-yellow-400">
                ⚡ VOLATILITY BLOCK
              </span>
            )}
            <span className={`px-2 py-0.5 rounded-full text-xs border ${
              sseConnected
                ? "bg-green-500/10 border-green-500/20 text-green-500"
                : "bg-gray-800/60 border-gray-700/40 text-gray-600"
            }`}>
              {sseConnected ? "● SSE Live" : "○ SSE Off"}
            </span>
          </div>
        </div>

        {/* Warning pills */}
        {ar && ar.warnings.length > 0 && (
          <div className="mt-3 space-y-1">
            {ar.warnings.map((w, i) => (
              <div key={i}
                className="flex items-start gap-2 text-xs text-yellow-400 bg-yellow-500/5 border border-yellow-500/15 rounded-lg px-3 py-1.5"
              >
                <span className="shrink-0">⚠</span>
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 2. Metrics Grid ─────────────────────────────────────────────────── */}
      {ar ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetricCard
            label="Drawdown"
            value={`${(ar.drawdownPct * 100).toFixed(2)}%`}
            sub={`Peak $${ar.peakBalance.toFixed(2)} → Now $${ar.currentBalance.toFixed(2)}`}
            color={
              ar.drawdownPct > 0.15 ? "text-red-400"
              : ar.drawdownPct > 0.08 ? "text-yellow-400"
              : "text-green-400"
            }
          />
          <MetricCard
            label="Daily P&L"
            value={`${pnlSign(ar.dailyPnlUsd)}$${ar.dailyPnlUsd.toFixed(2)}`}
            sub={`limit $${ar.config.dailyLossLimitUsd}`}
            color={pnlColor(ar.dailyPnlUsd)}
          />
          <MetricCard
            label="Weekly P&L"
            value={`${pnlSign(ar.weeklyPnlUsd)}$${ar.weeklyPnlUsd.toFixed(2)}`}
            sub={`limit $${ar.config.weeklyLossLimitUsd}`}
            color={pnlColor(ar.weeklyPnlUsd)}
          />
          <MetricCard
            label="Monthly P&L"
            value={`${pnlSign(ar.monthlyPnlUsd)}$${ar.monthlyPnlUsd.toFixed(2)}`}
            sub={`limit $${ar.config.monthlyLossLimitUsd}`}
            color={pnlColor(ar.monthlyPnlUsd)}
          />
          <MetricCard
            label="Loss Streak"
            value={`${ar.consecutiveLosses} / ${ar.config.consecutiveLossLimit}`}
            sub="consecutive losses"
            color={
              ar.consecutiveLosses >= ar.config.consecutiveLossLimit ? "text-red-400"
              : ar.consecutiveLosses >= ar.config.consecutiveLossLimit - 1 ? "text-yellow-400"
              : "text-white"
            }
          />
          <MetricCard
            label="Cooldown"
            value={ar.cooldownRemainingMs > 0 ? fmtMs(ar.cooldownRemainingMs) : "None"}
            sub={
              ar.cooldownUntil
                ? `ends ${new Date(ar.cooldownUntil).toLocaleTimeString()}`
                : "not in cooldown"
            }
            color={ar.cooldownRemainingMs > 0 ? "text-orange-400" : "text-gray-500"}
          />
          <MetricCard
            label="Volatility"
            value={ar.volatilityBlocked ? "BLOCKED" : "OK"}
            sub={ar.volatilityReason ?? `ATR ×${ar.config.volatilityAtrMultiple} threshold`}
            color={ar.volatilityBlocked ? "text-yellow-400" : "text-green-400"}
          />
          <MetricCard
            label="Max Drawdown"
            value={`${(ar.config.maxDrawdownPct * 100).toFixed(0)}%`}
            sub={`cooldown: ${fmtMs(ar.config.cooldownAfterLossMs)}`}
            color="text-gray-300"
          />
        </div>
      ) : (
        <div className="bg-gray-800/40 border border-gray-700/50 rounded-xl p-6 text-center">
          <p className="text-gray-600 text-sm">Advanced risk data not yet available</p>
          <p className="text-gray-700 text-xs mt-1">Connect to the server to load engine status</p>
        </div>
      )}

      {/* ── 3. Runtime Action Buttons ────────────────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
        <p className="text-white font-bold text-sm mb-3">⚡ Runtime Controls</p>

        <div className="grid grid-cols-2 gap-3">
          {/* Clear Halt */}
          <button
            onClick={() => setShowHaltConfirm(true)}
            disabled={clearingHalt || disabled || state !== "HALTED"}
            className="py-2.5 rounded-xl border font-bold text-sm transition-colors flex items-center justify-center gap-2 bg-red-500/20 border-red-500/40 text-red-400 hover:bg-red-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {clearingHalt ? <Spinner /> : <span>🔓</span>}
            Clear Halt
          </button>

          {/* Clear Cooldown */}
          <button
            onClick={handleClearCooldown}
            disabled={clearingCooldown || disabled || state !== "COOLDOWN"}
            className="py-2.5 rounded-xl border font-bold text-sm transition-colors flex items-center justify-center gap-2 bg-orange-500/20 border-orange-500/40 text-orange-400 hover:bg-orange-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {clearingCooldown ? <Spinner /> : <span>⏭️</span>}
            Clear Cooldown
          </button>

          {/* Reset PnL Counters */}
          <button
            onClick={handleResetPnl}
            disabled={resettingPnl || disabled}
            className="py-2.5 rounded-xl border font-bold text-sm transition-colors flex items-center justify-center gap-2 bg-blue-500/20 border-blue-500/40 text-blue-400 hover:bg-blue-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {resettingPnl ? <Spinner /> : <span>↩️</span>}
            Reset PnL Counters
          </button>

          {/* Reset Loss Streak */}
          <button
            onClick={handleResetStreak}
            disabled={resettingStreak || disabled}
            className="py-2.5 rounded-xl border font-bold text-sm transition-colors flex items-center justify-center gap-2 bg-purple-500/20 border-purple-500/40 text-purple-400 hover:bg-purple-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {resettingStreak ? <Spinner /> : <span>🔄</span>}
            Reset Loss Streak
          </button>
        </div>

        {/* Action hints */}
        <div className="mt-3 grid grid-cols-2 gap-x-4 text-xs text-gray-600">
          <span>Clear Halt — only active when engine is HALTED</span>
          <span>Clear Cooldown — only active during COOLDOWN</span>
          <span>Reset PnL — zeroes daily / weekly / monthly totals</span>
          <span>Reset Streak — clears consecutive loss counter</span>
        </div>
      </div>

      {/* ── 4. Advanced Config Editor (expandable) ───────────────────────────── */}
      <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
        <button
          onClick={() => setShowConfig((v) => !v)}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-800/40 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span>⚙️</span>
            <span className="text-sm font-bold text-gray-300">Advanced Risk Config</span>
            <span className="text-xs text-gray-500">— 9 live-editable limits</span>
          </div>
          <span className="text-gray-500 text-sm">{showConfig ? "▲" : "▼"}</span>
        </button>

        {showConfig && (
          <div className="px-4 pb-4 border-t border-gray-800">
            <div className="pt-4">
              <ConfigEditor
                config={ar?.config}
                onSave={onUpdateConfig}
                disabled={disabled}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── 5. Risk Event Console ───────────────────────────────────────────── */}
      <RiskConsole timeline={timeline} sseConnected={sseConnected} onClear={() => setTimeline([])} />

      {/* ── Confirm Modal: Clear Halt ────────────────────────────────────────── */}
      {showHaltConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-gray-900 border border-red-500/40 rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl">
            <div className="text-center mb-4">
              <span className="text-5xl">⚠️</span>
              <p className="text-white font-bold text-lg mt-3">Clear Risk Halt?</p>
              <p className="text-gray-400 text-sm mt-2">
                This will allow trading to resume. Ensure the underlying issue has been addressed.
              </p>
              {ar?.haltReason && (
                <div className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-left">
                  <p className="text-red-400 text-xs leading-relaxed">{ar.haltReason}</p>
                </div>
              )}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowHaltConfirm(false)}
                className="flex-1 py-2.5 rounded-xl border border-gray-700 text-gray-400 font-bold text-sm hover:bg-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleClearHalt}
                className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-sm transition-colors"
              >
                Yes, Clear Halt
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
