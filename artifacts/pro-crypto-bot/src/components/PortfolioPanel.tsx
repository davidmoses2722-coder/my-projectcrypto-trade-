/**
 * PortfolioPanel — live open positions table + exposure tracking.
 *
 * Reads status.portfolio (polled every 3 s via /api/status) and displays:
 *   • Summary: open count, total exposure, unrealized P&L
 *   • Open positions table: symbol, engine, entry, live price, PnL, SL, TP, age
 *   • Exposure bar: used vs. max USDT limit
 *   • Per-strategy allocation breakdown
 */

import type { ServerStatus, PortfolioPosition } from "../hooks/useBotServer";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function age(openedAt: number): string {
  const ms = Date.now() - openedAt;
  const s  = Math.floor(ms / 1000);
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function pnlColor(n: number): string {
  if (n > 0)  return "text-green-400";
  if (n < 0)  return "text-red-400";
  return "text-gray-400";
}

function fmt(n: number, dec = 2): string {
  return n.toFixed(dec);
}

// ─── Position row ─────────────────────────────────────────────────────────────

function PositionRow({ pos }: { pos: PortfolioPosition }) {
  const pnl    = pos.unrealizedPnl;
  const pnlPct = pos.unrealizedPnlPct;
  const tag    = pos.dryRun ? "PAPER" : "LIVE";

  return (
    <tr className="border-b border-gray-800 hover:bg-gray-800/40 transition-colors">
      <td className="py-2.5 px-3 text-xs">
        <div className="font-bold text-white">{pos.symbol}</div>
        <div className="text-gray-600 text-xs">{tag}</div>
      </td>
      <td className="py-2.5 px-3 text-xs text-gray-400 max-w-[90px] truncate">
        {pos.strategy.replace("Strategy", "")}
      </td>
      <td className="py-2.5 px-3 text-xs text-gray-300">
        ${fmt(pos.entryPrice)}
      </td>
      <td className="py-2.5 px-3 text-xs text-cyan-300">
        ${fmt(pos.lastPrice)}
      </td>
      <td className={`py-2.5 px-3 text-xs font-bold ${pnlColor(pnl)}`}>
        {pnl >= 0 ? "+" : ""}${fmt(pnl)}
        <span className="text-xs ml-1 font-normal opacity-70">
          ({pnlPct >= 0 ? "+" : ""}{fmt(pnlPct, 2)}%)
        </span>
      </td>
      <td className="py-2.5 px-3 text-xs text-red-400">
        ${fmt(pos.slPrice)}
      </td>
      <td className="py-2.5 px-3 text-xs text-green-400">
        ${fmt(pos.tpPrice)}
      </td>
      <td className="py-2.5 px-3 text-xs text-gray-500">
        {age(pos.openedAt)}
      </td>
      <td className="py-2.5 px-3 text-xs text-gray-400">
        ${fmt(pos.sizeUsdt, 0)}
      </td>
    </tr>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface PortfolioPanelProps {
  status: ServerStatus;
}

export function PortfolioPanel({ status }: PortfolioPanelProps) {
  const snap = status.portfolio;

  if (!snap) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center text-gray-600 text-xs">
        <p>Portfolio data not available</p>
      </div>
    );
  }

  const { positions, openCount, totalExposureUsdt, totalUnrealizedPnl, byStrategy, config } = snap;
  const exposurePct = config.maxTotalExposureUsdt > 0
    ? Math.min((totalExposureUsdt / config.maxTotalExposureUsdt) * 100, 100)
    : 0;
  const exposureColor =
    exposurePct >= 80 ? "bg-red-500" :
    exposurePct >= 50 ? "bg-yellow-400" : "bg-cyan-500";

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-3">
        <span className="text-xs">📂</span>
        <h3 className="text-white font-semibold text-sm">Open Positions</h3>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${
          openCount > 0
            ? "bg-green-500/15 border-green-500/30 text-green-400"
            : "bg-gray-700 border-gray-600 text-gray-500"
        }`}>
          {openCount} open
        </span>
        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse ml-auto" />
      </div>

      <div className="p-4 space-y-4">

        {/* ── Summary tiles ────────────────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-gray-800/60 border border-gray-700/60 rounded-lg p-3">
            <p className="text-gray-500 text-[13px] font-bold uppercase tracking-wider mb-1">Exposure</p>
            <p className="text-white text-sm font-bold">${fmt(totalExposureUsdt, 0)}</p>
            <p className="text-gray-600 text-xs">of ${config.maxTotalExposureUsdt} limit</p>
          </div>
          <div className="bg-gray-800/60 border border-gray-700/60 rounded-lg p-3">
            <p className="text-gray-500 text-[13px] font-bold uppercase tracking-wider mb-1">Unrealized P&L</p>
            <p className={`text-sm font-bold ${pnlColor(totalUnrealizedPnl)}`}>
              {totalUnrealizedPnl >= 0 ? "+" : ""}${fmt(totalUnrealizedPnl)}
            </p>
            <p className="text-gray-600 text-xs">across {openCount} position{openCount !== 1 ? "s" : ""}</p>
          </div>
          <div className="bg-gray-800/60 border border-gray-700/60 rounded-lg p-3">
            <p className="text-gray-500 text-[13px] font-bold uppercase tracking-wider mb-1">Capacity</p>
            <p className="text-white text-sm font-bold">{openCount}/{config.maxOpenPositions}</p>
            <p className="text-gray-600 text-xs">positions used</p>
          </div>
        </div>

        {/* ── Exposure bar ─────────────────────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-gray-500 text-[13px] font-bold uppercase tracking-wider">Exposure Usage</span>
            <span className="text-xs text-gray-400">{exposurePct.toFixed(1)}%</span>
          </div>
          <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${exposureColor}`}
              style={{ width: `${exposurePct}%` }}
            />
          </div>
          {exposurePct >= 80 && (
            <p className="text-red-400 text-xs mt-1">⚠ Near exposure limit — new entries may be blocked</p>
          )}
        </div>

        {/* ── Per-strategy breakdown ───────────────────────────────────────── */}
        {Object.keys(byStrategy).length > 0 && (
          <div>
            <p className="text-gray-500 text-[13px] font-bold uppercase tracking-wider mb-2">By Strategy</p>
            <div className="space-y-1.5">
              {Object.entries(byStrategy).map(([name, data]) => (
                <div key={name} className="flex items-center gap-2">
                  <span className="text-gray-400 text-xs w-28 truncate">{name.replace("Strategy", "")}</span>
                  <div className="flex-1 h-1 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-cyan-500 rounded-full"
                      style={{ width: `${Math.min((data.count / config.maxPerStrategy) * 100, 100)}%` }}
                    />
                  </div>
                  <span className="text-gray-500 text-xs w-16 text-right">
                    {data.count}/{config.maxPerStrategy} · ${fmt(data.exposureUsdt, 0)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Positions table ──────────────────────────────────────────────── */}
        {positions.length > 0 ? (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-left border-collapse min-w-[560px]">
              <thead>
                <tr className="border-b border-gray-700">
                  {["Symbol", "Engine", "Entry", "Price", "Unreal. P&L", "SL", "TP", "Age", "Size"].map((h) => (
                    <th key={h} className="py-1.5 px-3 text-gray-600 text-[13px] font-bold uppercase tracking-wider font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {positions.map((pos) => (
                  <PositionRow key={pos.id} pos={pos} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-6 text-gray-700">
            <p className="text-2xl mb-1">📭</p>
            <p className="text-xs">No open positions</p>
            <p className="text-xs mt-0.5 text-gray-800">Positions appear here when the bot opens a trade</p>
          </div>
        )}
      </div>
    </div>
  );
}
