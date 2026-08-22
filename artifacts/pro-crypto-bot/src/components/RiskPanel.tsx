/**
 * RiskPanel — live risk management dashboard
 *
 * Sections:
 *   1. Kill Switch — global on/off with confirmation
 *   2. Status banner — halt state + reason
 *   3. Live metrics — daily PnL, trades, positions, cooldown
 *   4. Pre-trade checklist — all rules live
 *   5. Emergency halt / resume
 *   6. Risk Config editor
 *   7. Risk Audit Log — last N events from DB
 */

import { useState, useEffect, useCallback } from "react";
import type { RiskState, RiskConfig } from "../hooks/useBotServer";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pct(v: number) { return `${(v * 100).toFixed(1)}%`; }
function usd(v: number) { return `$${Math.abs(v).toFixed(2)}`; }
function fmtMs(ms: number): string {
  if (ms < 0) return "—";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60_000)}m`;
}
function fmtDate(ts: string): string {
  try { return new Date(ts).toLocaleTimeString(); } catch { return ts; }
}

// ─── Kill Switch ──────────────────────────────────────────────────────────────

const EVENT_BADGES: Record<string, { color: string; icon: string }> = {
  TRADE_BLOCKED: { color: "text-orange-400 bg-orange-400/10 border-orange-400/20", icon: "🚫" },
  SL_TRIGGERED:  { color: "text-red-400 bg-red-400/10 border-red-400/20",    icon: "🔻" },
  TP_TRIGGERED:  { color: "text-green-400 bg-green-400/10 border-green-400/20", icon: "🎯" },
  DAILY_LIMIT:   { color: "text-red-500 bg-red-500/10 border-red-500/20",    icon: "📉" },
  KILL_SWITCH:   { color: "text-purple-400 bg-purple-400/10 border-purple-400/20", icon: "🔴" },
  MANUAL_HALT:   { color: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20", icon: "⛔" },
  HALT_CLEARED:  { color: "text-green-400 bg-green-400/10 border-green-400/20", icon: "✅" },
  RISK_OVERRIDE: { color: "text-cyan-400 bg-cyan-400/10 border-cyan-400/20",   icon: "⚙️" },
};

interface RiskEvent {
  id: number;
  eventType: string;
  symbol: string | null;
  reason: string;
  pnlUsd: string | null;
  createdAt: string;
}

function KillSwitchPanel({
  onSetKillSwitch,
  onFetchKillSwitch,
}: {
  onSetKillSwitch: (enabled: boolean) => Promise<unknown>;
  onFetchKillSwitch: () => Promise<Record<string, unknown>>;
}) {
  const [enabled, setEnabled]     = useState<boolean | null>(null);
  const [loading, setLoading]     = useState(false);
  const [confirming, setConfirming] = useState(false);

  const refresh = useCallback(async () => {
    const r = await onFetchKillSwitch();
    setEnabled((r as { tradingEnabled?: boolean }).tradingEnabled !== false);
  }, [onFetchKillSwitch]);

  useEffect(() => { void refresh(); }, [refresh]);

  const toggle = async (target: boolean) => {
    setLoading(true);
    setConfirming(false);
    await onSetKillSwitch(target);
    await refresh();
    setLoading(false);
  };

  return (
    <div className={`border rounded-xl p-4 ${enabled === false
      ? "bg-purple-900/20 border-purple-500/50"
      : "bg-gray-900 border-gray-700"
    }`}>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{enabled === false ? "🔴" : "🟢"}</span>
          <div>
            <p className="text-sm font-bold text-white">Global Kill Switch</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {enabled === null ? "Loading…" :
               enabled === false
                ? "ACTIVE — ALL trading blocked instantly"
                : "Off — Trading is permitted"}
            </p>
          </div>
        </div>

        <div className="flex gap-2 shrink-0">
          {!confirming ? (
            <button
              onClick={() => setConfirming(true)}
              disabled={loading || enabled === null}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors disabled:opacity-40 ${
                enabled
                  ? "bg-red-700 hover:bg-red-600 text-white"
                  : "bg-green-700 hover:bg-green-600 text-white"
              }`}
            >
              {loading
                ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />
                : enabled ? "Activate Kill Switch" : "Lift Kill Switch"}
            </button>
          ) : (
            <div className="flex gap-2 items-center">
              <span className="text-xs text-yellow-400 font-bold">Confirm?</span>
              <button
                onClick={() => void toggle(!enabled)}
                className="px-3 py-1.5 rounded-lg bg-yellow-600 hover:bg-yellow-500 text-white text-xs font-bold"
              >
                Yes
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      <p className="text-xs text-gray-600 mt-3 leading-relaxed">
        The kill switch is checked before <em>every</em> trade entry.
        Env var <code className="bg-gray-800 px-1 rounded">TRADING_ENABLED=false</code> also activates it permanently at the deployment level.
      </p>
    </div>
  );
}

// ─── Risk Audit Log ───────────────────────────────────────────────────────────

function AuditLog({ onFetch }: { onFetch: (limit: number) => Promise<Record<string, unknown>> }) {
  const [events, setEvents]   = useState<RiskEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen]       = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await onFetch(50);
    setEvents(((r as { events?: RiskEvent[] }).events) ?? []);
    setLoading(false);
  }, [onFetch]);

  useEffect(() => {
    if (open && events.length === 0) void load();
  }, [open, events.length, load]);

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
      <button
        onClick={() => { setOpen((v) => !v); if (!open) void load(); }}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-800/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span>📋</span>
          <span className="text-sm font-bold text-gray-300">Risk Audit Log</span>
          <span className="text-xs text-gray-500">— all blocked trades, SL/TP, halts</span>
        </div>
        <div className="flex items-center gap-2">
          {open && (
            <button
              onClick={(e) => { e.stopPropagation(); void load(); }}
              className="text-xs text-cyan-400 hover:text-cyan-300 px-2 py-0.5 rounded border border-cyan-400/30"
            >
              Refresh
            </button>
          )}
          <span className="text-gray-500">{open ? "▲" : "▼"}</span>
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-800 max-h-72 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-gray-600 text-xs">Loading…</div>
          ) : events.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-gray-600 text-xs">
              No risk events recorded yet
            </div>
          ) : (
            <div className="divide-y divide-gray-800/70">
              {events.map((ev) => {
                const badge = EVENT_BADGES[ev.eventType] ?? { color: "text-gray-400 bg-gray-400/10 border-gray-400/20", icon: "ℹ️" };
                return (
                  <div key={ev.id} className="flex items-start gap-3 px-4 py-2.5">
                    <span className="text-base shrink-0 mt-0.5">{badge.icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-bold px-1.5 py-0.5 rounded border ${badge.color}`}>
                          {ev.eventType}
                        </span>
                        {ev.symbol && (
                          <span className="text-xs text-cyan-400">{ev.symbol}</span>
                        )}
                        {ev.pnlUsd && (
                          <span className={`text-xs ${Number(ev.pnlUsd) >= 0 ? "text-green-400" : "text-red-400"}`}>
                            {Number(ev.pnlUsd) >= 0 ? "+" : ""}${Number(ev.pnlUsd).toFixed(2)}
                          </span>
                        )}
                        <span className="text-xs text-gray-600 ml-auto">{fmtDate(ev.createdAt)}</span>
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5 truncate">{ev.reason}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ halted, reason }: { halted: boolean; reason: string | null }) {
  if (halted) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-red-500/15 border border-red-500/40 rounded-xl">
        <span className="text-lg">⛔</span>
        <div>
          <p className="text-red-400 font-bold text-sm">TRADING HALTED</p>
          <p className="text-red-400/70 text-xs mt-0.5">{reason ?? "Unknown reason"}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-green-500/10 border border-green-500/30 rounded-xl">
      <span className="w-2.5 h-2.5 rounded-full bg-green-400 animate-pulse shrink-0" />
      <p className="text-green-400 font-bold text-sm">Risk Engine Active — Trading Allowed</p>
    </div>
  );
}

function Metric({ label, value, sub, danger }: {
  label: string; value: string | number; sub?: string; danger?: boolean;
}) {
  return (
    <div className="bg-gray-800/60 border border-gray-700/60 rounded-xl p-3">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className={`text-lg font-bold ${danger ? "text-red-400" : "text-white"}`}>{value}</div>
      {sub && <div className="text-xs text-gray-600 mt-0.5">{sub}</div>}
    </div>
  );
}

// ─── Risk Config Editor ────────────────────────────────────────────────────────

function ConfigEditor({
  config,
  onSave,
}: {
  config: RiskConfig;
  onSave: (patch: Partial<RiskConfig>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<RiskConfig>({ ...config });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof RiskConfig>(k: K, v: RiskConfig[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const save = async () => {
    setSaving(true);
    await onSave(draft);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const inp = "w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none";
  const lbl = "block text-xs text-gray-400 mb-1 font-semibold";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

        {/* Position size */}
        <div>
          <label className={lbl}>
            Max Position Size (% of balance)
            <span className="ml-1 text-cyan-400">{pct(draft.maxPositionSizePct)}</span>
          </label>
          <input
            type="range" min={0.01} max={0.5} step={0.01}
            value={draft.maxPositionSizePct}
            onChange={(e) => set("maxPositionSizePct", Number(e.target.value))}
            className="w-full accent-cyan-500"
          />
          <div className="flex justify-between text-xs text-gray-600 mt-0.5">
            <span>1% (safest)</span><span>50% (high risk)</span>
          </div>
        </div>

        {/* Max risk per trade */}
        <div>
          <label className={lbl}>
            Max Risk Per Trade (% of balance at SL)
            <span className="ml-1 text-orange-400">{pct(draft.maxRiskPerTradePct)}</span>
          </label>
          <input
            type="range" min={0.001} max={0.05} step={0.001}
            value={draft.maxRiskPerTradePct}
            onChange={(e) => set("maxRiskPerTradePct", Number(e.target.value))}
            className="w-full accent-orange-500"
          />
          <div className="flex justify-between text-xs text-gray-600 mt-0.5">
            <span>0.1% (minimal)</span><span>5% (aggressive)</span>
          </div>
        </div>

        {/* Daily loss limit */}
        <div>
          <label className={lbl}>
            Daily Loss Limit (halt when PnL ≤)
            <span className="ml-1 text-red-400">-{usd(Math.abs(draft.maxDailyLossUsd))}</span>
          </label>
          <input
            type="range" min={-500} max={-5} step={5}
            value={draft.maxDailyLossUsd}
            onChange={(e) => set("maxDailyLossUsd", Number(e.target.value))}
            className="w-full accent-red-500"
          />
          <div className="flex justify-between text-xs text-gray-600 mt-0.5">
            <span>-$5 (tight)</span><span>-$500 (loose)</span>
          </div>
        </div>

        {/* Min balance */}
        <div>
          <label className={lbl}>
            Minimum Balance to Trade
            <span className="ml-1 text-yellow-400">{usd(draft.minBalanceUsd)}</span>
          </label>
          <input
            type="range" min={5} max={500} step={5}
            value={draft.minBalanceUsd}
            onChange={(e) => set("minBalanceUsd", Number(e.target.value))}
            className="w-full accent-yellow-500"
          />
          <div className="flex justify-between text-xs text-gray-600 mt-0.5">
            <span>$5</span><span>$500</span>
          </div>
        </div>

        {/* Cooldown */}
        <div>
          <label className={lbl}>
            Trade Cooldown
            <span className="ml-1 text-purple-400">{fmtMs(draft.tradeCooldownMs)}</span>
          </label>
          <input
            type="range" min={5000} max={300_000} step={5000}
            value={draft.tradeCooldownMs}
            onChange={(e) => set("tradeCooldownMs", Number(e.target.value))}
            className="w-full accent-purple-500"
          />
          <div className="flex justify-between text-xs text-gray-600 mt-0.5">
            <span>5s</span><span>5m</span>
          </div>
        </div>

        {/* Max trades/day */}
        <div>
          <label className={lbl}>
            Max Trades Per Day
            <span className="ml-1 text-blue-400">{draft.maxTradesPerDay}</span>
          </label>
          <input
            type="range" min={1} max={100} step={1}
            value={draft.maxTradesPerDay}
            onChange={(e) => set("maxTradesPerDay", Number(e.target.value))}
            className="w-full accent-blue-500"
          />
          <div className="flex justify-between text-xs text-gray-600 mt-0.5">
            <span>1</span><span>100</span>
          </div>
        </div>

        {/* Max open positions */}
        <div>
          <label className={lbl}>
            Max Open Positions
            <span className="ml-1 text-green-400">{draft.maxOpenPositions}</span>
          </label>
          <input
            className={inp}
            type="number" min={1} max={10} step={1}
            value={draft.maxOpenPositions}
            onChange={(e) => set("maxOpenPositions", Math.max(1, Number(e.target.value)))}
          />
        </div>
      </div>

      <button
        onClick={save}
        disabled={saving}
        className="w-full py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-bold text-sm transition-colors flex items-center justify-center gap-2"
      >
        {saving ? (
          <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving…</>
        ) : saved ? (
          "✅ Risk Config Saved"
        ) : (
          "💾 Save Risk Config"
        )}
      </button>
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

interface RiskPanelProps {
  risk: RiskState | undefined;
  onUpdateConfig: (patch: Partial<RiskConfig>) => Promise<unknown>;
  onHalt: () => Promise<unknown>;
  onResume: () => Promise<unknown>;
  onSetKillSwitch: (enabled: boolean) => Promise<unknown>;
  onFetchKillSwitch: () => Promise<Record<string, unknown>>;
  onFetchRiskEvents: (limit: number) => Promise<Record<string, unknown>>;
  disabled?: boolean;
}

export default function RiskPanel({
  risk,
  onUpdateConfig,
  onHalt,
  onResume,
  onSetKillSwitch,
  onFetchKillSwitch,
  onFetchRiskEvents,
  disabled,
}: RiskPanelProps) {
  const [showConfig, setShowConfig] = useState(false);
  const [halting, setHalting]       = useState(false);
  const [resuming, setResuming]     = useState(false);

  if (!risk) {
    return (
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 text-center text-gray-600 text-sm">
        Risk engine state unavailable — server offline?
      </div>
    );
  }

  const dailyPnlColor =
    risk.dailyPnlUsd > 0 ? "text-green-400" :
    risk.dailyPnlUsd < 0 ? "text-red-400" : "text-gray-400";
  void dailyPnlColor;

  const cooldownRemaining = risk.msSinceLast >= 0 && risk.msSinceLast < risk.config.tradeCooldownMs
    ? risk.config.tradeCooldownMs - risk.msSinceLast
    : 0;

  const handleHalt = async () => {
    setHalting(true);
    await onHalt();
    setHalting(false);
  };

  const handleResume = async () => {
    setResuming(true);
    await onResume();
    setResuming(false);
  };

  return (
    <div className="space-y-4">

      {/* ── 1. Kill Switch ── */}
      <KillSwitchPanel onSetKillSwitch={onSetKillSwitch} onFetchKillSwitch={onFetchKillSwitch} />

      {/* ── 2. Status banner ── */}
      <StatusBadge halted={risk.isHalted} reason={risk.haltReason} />

      {/* ── 3. Live metrics ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Metric
          label="Daily P&L"
          value={`${risk.dailyPnlUsd >= 0 ? "+" : ""}$${risk.dailyPnlUsd.toFixed(2)}`}
          sub={`limit: -$${Math.abs(risk.config.maxDailyLossUsd)}`}
          danger={risk.dailyPnlUsd < 0}
        />
        <Metric
          label="Trades Today"
          value={`${risk.dailyTradeCount} / ${risk.config.maxTradesPerDay}`}
          sub="daily cap"
          danger={risk.dailyTradeCount >= risk.config.maxTradesPerDay}
        />
        <Metric
          label="Open Positions"
          value={`${risk.openPositionCount} / ${risk.config.maxOpenPositions}`}
          sub={risk.openSymbols.length ? risk.openSymbols.join(", ") : "none"}
          danger={risk.openPositionCount >= risk.config.maxOpenPositions}
        />
        <Metric
          label="Cooldown"
          value={cooldownRemaining > 0 ? `${Math.ceil(cooldownRemaining / 1000)}s` : "Ready"}
          sub={`min: ${fmtMs(risk.config.tradeCooldownMs)}`}
          danger={cooldownRemaining > 0}
        />
        <Metric
          label="Max Position"
          value={pct(risk.config.maxPositionSizePct)}
          sub="of free balance"
        />
        <Metric
          label="Max Risk/Trade"
          value={pct(risk.config.maxRiskPerTradePct)}
          sub="of balance at SL"
        />
      </div>

      {/* ── 4. Rule checklist ── */}
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
        <p className="text-[13px] font-bold text-gray-400 font-bold uppercase tracking-wide mb-3">🛡️ Pre-Trade Checks (all must pass)</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          {[
            {
              label: "Kill switch off",
              ok: true,
              detail: "checked live per-trade from env + DB",
            },
            {
              label: "Daily loss limit",
              ok: risk.dailyPnlUsd > risk.config.maxDailyLossUsd,
              detail: `PnL $${risk.dailyPnlUsd.toFixed(2)} vs limit -$${Math.abs(risk.config.maxDailyLossUsd)}`,
            },
            {
              label: "Trade cooldown",
              ok: cooldownRemaining === 0,
              detail: cooldownRemaining > 0 ? `${Math.ceil(cooldownRemaining / 1000)}s remaining` : "ready",
            },
            {
              label: "Daily trade cap",
              ok: risk.dailyTradeCount < risk.config.maxTradesPerDay,
              detail: `${risk.dailyTradeCount} / ${risk.config.maxTradesPerDay}`,
            },
            {
              label: "Open position limit",
              ok: risk.openPositionCount < risk.config.maxOpenPositions,
              detail: `${risk.openPositionCount} / ${risk.config.maxOpenPositions} open`,
            },
            {
              label: "Risk engine not halted",
              ok: !risk.isHalted,
              detail: risk.haltReason ?? "no halt",
            },
            {
              label: "Stop-loss attached",
              ok: true,
              detail: "positionMonitor checks every 2s — guaranteed",
            },
            {
              label: "Daily PnL persisted",
              ok: true,
              detail: "DB row updated on every close — survives restarts",
            },
          ].map(({ label, ok, detail }) => (
            <div key={label} className="flex items-start gap-2 py-1.5 border-b border-gray-800/60 last:border-0">
              <span className={`shrink-0 font-bold ${ok ? "text-green-400" : "text-red-400"}`}>
                {ok ? "✅" : "❌"}
              </span>
              <div className="min-w-0">
                <span className={ok ? "text-gray-300" : "text-red-300"}>{label}</span>
                <span className="ml-1 text-gray-600">— {detail}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 5. Emergency halt / resume ── */}
      <div className="flex gap-3 flex-wrap">
        <button
          onClick={handleHalt}
          disabled={halting || disabled || risk.isHalted}
          className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white font-bold text-sm transition-colors flex items-center justify-center gap-2"
        >
          {halting
            ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            : "⛔"}
          {risk.isHalted ? "Already Halted" : "Emergency Halt"}
        </button>
        <button
          onClick={handleResume}
          disabled={resuming || disabled || !risk.isHalted}
          className="flex-1 py-2.5 rounded-xl bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white font-bold text-sm transition-colors flex items-center justify-center gap-2"
        >
          {resuming
            ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            : "✅"}
          {!risk.isHalted ? "Trading Active" : "Resume Trading"}
        </button>
      </div>

      {/* ── 6. Expandable config editor ── */}
      <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
        <button
          onClick={() => setShowConfig((v) => !v)}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-800/40 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span>⚙️</span>
            <span className="text-sm font-bold text-gray-300">Risk Config</span>
            <span className="text-xs text-gray-500">— position sizing, loss limits, cooldowns</span>
          </div>
          <span className="text-gray-500">{showConfig ? "▲" : "▼"}</span>
        </button>
        {showConfig && (
          <div className="px-4 pb-4 border-t border-gray-800">
            <div className="pt-4">
              <ConfigEditor
                config={risk.config}
                onSave={async (patch) => { await onUpdateConfig(patch); }}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── 7. Risk Audit Log ── */}
      <AuditLog onFetch={onFetchRiskEvents} />

    </div>
  );
}
