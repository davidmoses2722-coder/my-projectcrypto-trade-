/**
 * StrategySignalPanel — real-time indicator readout for the active strategy engine.
 *
 * Reads status.strategy (polled every 3 s from /api/status) and displays:
 *   • Action badge (BUY / SELL / HOLD) + confidence bar
 *   • Engine-aware EMA labels (EMA9/21 for Scalping, EMA50/200 for Swing, etc.)
 *   • RSI, ATR, volume ratio tiles
 *   • Suggested SL / TP prices
 *   • Signal reason text + canTrade gate
 */

import type { ServerStatus, StrategySignalData } from "../hooks/useBotServer";

// ── EMA label mapping per engine ──────────────────────────────────────────────
function getEmaLabels(engine?: string): { fast: string; slow: string } {
  if (engine?.includes("Scalping"))   return { fast: "EMA9",     slow: "EMA21"  };
  if (engine?.includes("DayTrading")) return { fast: "EMA20",    slow: "EMA50"  };
  if (engine?.includes("Swing"))      return { fast: "EMA50",    slow: "EMA200" };
  if (engine?.includes("Dca"))        return { fast: "EMA14",    slow: "—"      };
  if (engine?.includes("Grid"))       return { fast: "Midpoint", slow: "—"      };
  return { fast: "EMA-F", slow: "EMA-S" };
}

// ── Numeric formatter ─────────────────────────────────────────────────────────
function fmt(n: number | null | undefined, dec = 2): string {
  if (n == null) return "—";
  return n.toFixed(dec);
}

// ── RSI colour ────────────────────────────────────────────────────────────────
function rsiColor(rsi: number | null): string {
  if (rsi == null) return "text-gray-500";
  if (rsi < 30)   return "text-green-400";
  if (rsi > 70)   return "text-red-400";
  if (rsi < 45)   return "text-cyan-400";
  if (rsi > 55)   return "text-orange-400";
  return "text-gray-300";
}

// ── Action badge ──────────────────────────────────────────────────────────────
function ActionBadge({ action }: { action: StrategySignalData["action"] }) {
  const styles: Record<string, string> = {
    BUY:   "bg-green-500/20 border-green-500/50 text-green-300",
    SELL:  "bg-red-500/20   border-red-500/50   text-red-300",
    SHORT: "bg-red-500/20   border-red-500/50   text-red-300",
    HOLD:  "bg-gray-700     border-gray-600     text-gray-300",
  };
  const icons: Record<string, string> = { BUY: "▲", SELL: "▼", SHORT: "▼", HOLD: "–" };
  return (
    <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full border text-sm font-black tracking-wide ${styles[action] ?? styles.HOLD}`}>
      <span>{icons[action] ?? "–"}</span>
      {action}
    </span>
  );
}

// ── Mode badge (Phase 8.7 — LONG MODE / SHORT MODE) ───────────────────────────
function ModeBadge({ mode }: { mode: "LONG" | "SHORT" | null | undefined }) {
  if (!mode) return null;
  const isLong = mode === "LONG";
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-[13px] font-bold font-bold tracking-wider uppercase ${
      isLong
        ? "bg-cyan-500/10 border-cyan-500/40 text-cyan-300"
        : "bg-orange-500/10 border-orange-500/40 text-orange-300"
    }`}>
      {isLong ? "↑" : "↓"} {mode} MODE
    </span>
  );
}

// ── Confidence bar ────────────────────────────────────────────────────────────
function ConfidenceBar({ pct }: { pct: number }) {
  const color = pct >= 70 ? "bg-green-500" : pct >= 40 ? "bg-yellow-400" : "bg-gray-600";
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-400 w-8 text-right">{pct}%</span>
    </div>
  );
}

// ── Indicator tile ────────────────────────────────────────────────────────────
function Tile({ label, value, sub, valueClass = "text-white" }: {
  label: string; value: string; sub?: string; valueClass?: string;
}) {
  return (
    <div className="bg-gray-800/60 border border-gray-700/60 rounded-lg p-2.5">
      <p className="text-gray-500 text-[13px] font-bold uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-sm font-bold ${valueClass}`}>{value}</p>
      {sub && <p className="text-gray-600 text-xs mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
interface StrategySignalPanelProps {
  status: ServerStatus;
}

export function StrategySignalPanel({ status }: StrategySignalPanelProps) {
  const sig    = status.strategy;
  const engine = status.activeEngine ?? "";
  const labels = getEmaLabels(engine);

  if (!sig) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center text-gray-600 text-xs">
        <p className="text-2xl mb-1">📡</p>
        <p>Waiting for first tick…</p>
        <p className="text-xs mt-0.5 text-gray-700">Indicators appear after candles load</p>
      </div>
    );
  }

  const volRatio = sig.currentVol != null && sig.avgVol != null && sig.avgVol > 0
    ? (sig.currentVol / sig.avgVol).toFixed(2)
    : "—";
  const volColor = volRatio !== "—" && parseFloat(volRatio) > 1.2
    ? "text-green-400" : volRatio !== "—" && parseFloat(volRatio) < 0.8
    ? "text-red-400" : "text-gray-300";

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-3">
        <span className="text-xs">📡</span>
        <h3 className="text-white font-semibold text-sm">Live Signal</h3>
        <span className="text-gray-600 text-xs">{engine}</span>
        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse ml-auto" />
      </div>

      <div className="p-4 space-y-3">

        {/* ── Mode (Phase 8.7 — LONG MODE / SHORT MODE) ────────────────────── */}
        {sig.mode && (
          <div className="flex items-center gap-2">
            <ModeBadge mode={sig.mode} />
            {sig.conditionsMet != null && sig.conditionsTotal != null && (
              <span className="text-xs text-gray-500">
                Conditions Met: {sig.conditionsMet}/{sig.conditionsTotal}
              </span>
            )}
          </div>
        )}

        {/* ── Action + confidence ──────────────────────────────────────────── */}
        <div className="flex items-center gap-3">
          <ActionBadge action={sig.action} />
          <div className="flex-1">
            <ConfidenceBar pct={sig.confidence} />
          </div>
        </div>

        {/* ── Missing conditions (HOLD diagnostics, Phase 8.7) ─────────────── */}
        {sig.action === "HOLD" && sig.missingConditions && sig.missingConditions.length > 0 && (
          <div className="text-xs text-gray-500">
            Missing: {sig.missingConditions.join(", ")}
          </div>
        )}

        {/* ── Indicator grid ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-2">
          <Tile
            label={labels.fast}
            value={fmt(sig.ema50)}
            valueClass={sig.ema50 != null && sig.ema200 != null
              ? sig.ema50 > sig.ema200 ? "text-green-400" : "text-red-400"
              : "text-gray-300"}
          />
          {sig.ema200 != null ? (
            <Tile
              label={labels.slow}
              value={fmt(sig.ema200)}
              valueClass="text-gray-300"
            />
          ) : (
            <Tile label={labels.slow} value="—" valueClass="text-gray-600" />
          )}
          <Tile
            label="RSI"
            value={fmt(sig.rsi, 1)}
            valueClass={rsiColor(sig.rsi)}
            sub={sig.rsi != null ? (sig.rsi < 30 ? "oversold" : sig.rsi > 70 ? "overbought" : "neutral") : undefined}
          />
          <Tile
            label="ATR"
            value={fmt(sig.atr)}
            sub={sig.atr != null && status.lastPrice > 0
              ? `${((sig.atr / status.lastPrice) * 100).toFixed(3)}% of price`
              : undefined}
          />
          <Tile
            label="Vol Ratio"
            value={volRatio}
            valueClass={volColor}
            sub={volRatio !== "—" && parseFloat(volRatio) > 1 ? "↑ above avg" : volRatio !== "—" ? "↓ below avg" : undefined}
          />
          {sig.suggestedSl != null ? (
            <Tile
              label="SL → TP"
              value={`${fmt(sig.suggestedSl)} → ${fmt(sig.suggestedTp)}`}
              sub={sig.stopLossPct != null
                ? `${(sig.stopLossPct * 100).toFixed(2)}% / ${sig.takeProfitPct != null ? (sig.takeProfitPct * 100).toFixed(2) : "—"}%`
                : undefined}
              valueClass="text-orange-300"
            />
          ) : (
            <Tile label="SL → TP" value="—" sub="no open position" valueClass="text-gray-600" />
          )}
        </div>

        {/* ── Reason text ──────────────────────────────────────────────────── */}
        <div className={`rounded-lg px-3 py-2 text-xs leading-relaxed ${
          sig.action === "BUY"  ? "bg-green-500/8 border border-green-500/20 text-green-300" :
          sig.action === "SELL" ? "bg-red-500/8   border border-red-500/20   text-red-300"   :
                                  "bg-gray-800    border border-gray-700     text-gray-400"
        }`}>
          {sig.reason}
        </div>

        {/* ── canTrade gate ────────────────────────────────────────────────── */}
        {!sig.canTrade && sig.blockReason && (
          <div className="rounded-lg px-3 py-2 bg-yellow-500/8 border border-yellow-500/20 text-yellow-400 text-xs">
            🔒 {sig.blockReason}
          </div>
        )}
      </div>
    </div>
  );
}
