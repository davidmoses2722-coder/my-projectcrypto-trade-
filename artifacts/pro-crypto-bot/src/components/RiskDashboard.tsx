/**
 * RiskDashboard — portfolio-level risk status panel.
 *
 * Shows the state of the advanced risk engine:
 *   • Portfolio state badge (ACTIVE / WARNING / COOLDOWN / HALTED)
 *   • Drawdown bar (current vs max)
 *   • Daily / Weekly / Monthly PnL
 *   • Consecutive loss counter
 *   • Cooldown countdown timer
 *   • Volatility block status
 *   • Active warnings list
 *
 * Updates every 3 s via the existing /api/status poll — no extra requests.
 */

import { useState, useEffect } from "react";
import type { ServerStatus, AdvancedRiskStatus } from "../hooks/useBotServer";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMs(ms: number): string {
  if (ms <= 0)   return "0s";
  const s = Math.ceil(ms / 1000);
  if (s < 60)    return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r > 0 ? `${m}m ${r}s` : `${m}m`;
}

function pnlColor(n: number): string {
  if (n > 0)  return "text-green-400";
  if (n < 0)  return "text-red-400";
  return "text-gray-400";
}

function fmtPnl(n: number): string {
  return `${n >= 0 ? "+" : ""}$${n.toFixed(2)}`;
}

// ─── State badge ──────────────────────────────────────────────────────────────

const STATE_CONFIG = {
  ACTIVE:   { label: "ACTIVE",   bg: "bg-green-500/20",  border: "border-green-500/40",  text: "text-green-400",  dot: "bg-green-400"  },
  WARNING:  { label: "WARNING",  bg: "bg-yellow-400/15", border: "border-yellow-400/40", text: "text-yellow-300", dot: "bg-yellow-400" },
  COOLDOWN: { label: "COOLDOWN", bg: "bg-blue-500/20",   border: "border-blue-500/40",   text: "text-blue-300",   dot: "bg-blue-400"   },
  HALTED:   { label: "HALTED",   bg: "bg-red-500/20",    border: "border-red-500/40",    text: "text-red-400",    dot: "bg-red-500"    },
} as const;

// ─── Cooldown live timer ───────────────────────────────────────────────────────

function CooldownTimer({ until }: { until: number }) {
  const [ms, setMs] = useState(() => Math.max(0, until - Date.now()));

  useEffect(() => {
    if (ms <= 0) return;
    const id = setInterval(() => {
      const rem = Math.max(0, until - Date.now());
      setMs(rem);
    }, 500);
    return () => clearInterval(id);
  }, [until, ms]);

  return (
    <span className="text-blue-300 font-bold tabular-nums">
      {fmtMs(ms)}
    </span>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface RiskDashboardProps {
  status: ServerStatus;
}

export function RiskDashboard({ status }: RiskDashboardProps) {
  const risk: AdvancedRiskStatus | undefined = status.advancedRisk;

  if (!risk) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center text-gray-600 text-xs">
        <p>Advanced risk data not available</p>
      </div>
    );
  }

  const sc = STATE_CONFIG[risk.state] ?? STATE_CONFIG.ACTIVE;
  const { config: cfg } = risk;

  // Drawdown bar
  const ddPct        = risk.drawdownPct * 100;
  const ddLimitPct   = cfg.maxDrawdownPct * 100;
  const ddBarWidth   = ddLimitPct > 0 ? Math.min((ddPct / ddLimitPct) * 100, 100) : 0;
  const ddBarColor   =
    ddBarWidth >= 80 ? "bg-red-500" :
    ddBarWidth >= 50 ? "bg-yellow-400" : "bg-cyan-500";

  // Consecutive loss bar
  const clBarWidth = cfg.consecutiveLossLimit > 0
    ? Math.min((risk.consecutiveLosses / cfg.consecutiveLossLimit) * 100, 100)
    : 0;
  const clBarColor =
    clBarWidth >= 100 ? "bg-red-500" :
    clBarWidth >=  67 ? "bg-yellow-400" : "bg-blue-400";

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-3">
        <span className="text-xs">🛡️</span>
        <h3 className="text-white font-semibold text-sm">Advanced Risk Engine</h3>

        {/* State badge */}
        <span className={`ml-1 px-2.5 py-0.5 rounded-full text-xs font-bold border flex items-center gap-1.5 ${sc.bg} ${sc.border} ${sc.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full inline-block ${sc.dot} ${risk.state !== "HALTED" ? "animate-pulse" : ""}`} />
          {sc.label}
        </span>

        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse ml-auto" />
      </div>

      <div className="p-4 space-y-4">

        {/* ── HALTED alert banner ───────────────────────────────────────────── */}
        {risk.state === "HALTED" && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2.5 text-xs text-red-300">
            <p className="font-bold text-red-400 mb-0.5">🚨 Risk engine halted — trading blocked</p>
            <p className="text-red-400/80">{risk.haltReason}</p>
          </div>
        )}

        {/* ── COOLDOWN alert ────────────────────────────────────────────────── */}
        {risk.state === "COOLDOWN" && risk.cooldownUntil !== null && (
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg px-3 py-2.5 text-xs text-blue-200">
            <p className="font-bold mb-0.5">⏸ Cooldown active — entries paused</p>
            <p className="flex items-center gap-1.5">
              Resumes in: <CooldownTimer until={risk.cooldownUntil} />
            </p>
          </div>
        )}

        {/* ── Warnings ─────────────────────────────────────────────────────── */}
        {risk.warnings.length > 0 && risk.state !== "HALTED" && (
          <div className="bg-yellow-400/5 border border-yellow-400/20 rounded-lg px-3 py-2 space-y-1">
            {risk.warnings.map((w, i) => (
              <p key={i} className="text-xs text-yellow-300 flex gap-1.5">
                <span className="shrink-0">⚠</span>{w}
              </p>
            ))}
          </div>
        )}

        {/* ── Drawdown ─────────────────────────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-gray-500 text-[13px] font-bold uppercase tracking-wider">Drawdown from Peak</span>
            <span className="text-xs text-gray-400">
              {ddPct.toFixed(2)}% <span className="text-gray-700">/ {ddLimitPct.toFixed(0)}% limit</span>
            </span>
          </div>
          <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${ddBarColor}`}
              style={{ width: `${ddBarWidth}%` }}
            />
          </div>
          <div className="flex justify-between mt-1 text-xs text-gray-700">
            <span>Peak ${risk.peakBalance.toFixed(0)}</span>
            <span>Now ${risk.currentBalance.toFixed(0)}</span>
          </div>
        </div>

        {/* ── PnL tiles ────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Daily P&L",   value: risk.dailyPnlUsd,   limit: cfg.dailyLossLimitUsd   },
            { label: "Weekly P&L",  value: risk.weeklyPnlUsd,  limit: cfg.weeklyLossLimitUsd  },
            { label: "Monthly P&L", value: risk.monthlyPnlUsd, limit: cfg.monthlyLossLimitUsd },
          ].map(({ label, value, limit }) => (
            <div key={label} className="bg-gray-800/60 border border-gray-700/60 rounded-lg p-2.5">
              <p className="text-gray-600 text-[13px] font-bold uppercase tracking-wider mb-1">{label}</p>
              <p className={`font-bold text-sm ${pnlColor(value)}`}>{fmtPnl(value)}</p>
              <p className="text-gray-700 text-xs mt-0.5">limit ${limit}</p>
            </div>
          ))}
        </div>

        {/* ── Consecutive losses ───────────────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-gray-500 text-[13px] font-bold uppercase tracking-wider">Consecutive Losses</span>
            <span className="text-xs text-gray-400">
              {risk.consecutiveLosses} <span className="text-gray-700">/ {cfg.consecutiveLossLimit} → cooldown</span>
            </span>
          </div>
          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${clBarColor}`}
              style={{ width: `${clBarWidth}%` }}
            />
          </div>
        </div>

        {/* ── Volatility state ─────────────────────────────────────────────── */}
        <div className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs border ${
          risk.volatilityBlocked
            ? "bg-orange-500/10 border-orange-500/30"
            : "bg-gray-800/50 border-gray-700/50"
        }`}>
          <span className={`w-2 h-2 rounded-full shrink-0 ${risk.volatilityBlocked ? "bg-orange-400 animate-pulse" : "bg-gray-600"}`} />
          <div className="flex-1 min-w-0">
            {risk.volatilityBlocked ? (
              <>
                <p className="text-orange-300 font-bold">Volatility Kill-Switch ACTIVE</p>
                <p className="text-orange-400/70 truncate mt-0.5">{risk.volatilityReason}</p>
              </>
            ) : (
              <p className="text-gray-500">
                Volatility monitor {cfg.volatilityKillSwitch ? "active" : "disabled"}
                {cfg.volatilityKillSwitch ? ` · ${cfg.volatilityAtrMultiple}× ATR spike threshold` : ""}
              </p>
            )}
          </div>
        </div>

        {/* ── Limits quick-ref ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-1.5">
          {[
            { label: "Max Drawdown",     value: `${(cfg.maxDrawdownPct * 100).toFixed(0)}%`       },
            { label: "Cooldown After",   value: `${cfg.consecutiveLossLimit} losses → ${Math.ceil(cfg.cooldownAfterLossMs / 60000)}m` },
            { label: "Max Concurrent ↓", value: `${cfg.maxConcurrentLosses} positions`            },
            { label: "ATR Spike",        value: cfg.volatilityKillSwitch ? `${cfg.volatilityAtrMultiple}× avg` : "off" },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between bg-gray-800/40 rounded-lg px-2.5 py-1.5">
              <span className="text-gray-600 text-xs">{label}</span>
              <span className="text-gray-400 text-xs">{value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
