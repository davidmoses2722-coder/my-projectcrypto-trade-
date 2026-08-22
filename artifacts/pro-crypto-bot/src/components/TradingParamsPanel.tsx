/**
 * TradingParamsPanel — Phase 13 Configuration Authority
 *
 * Single-source-of-truth panel for all configurable trading behaviour:
 *   • Position size mode  (auto risk / fixed USDT / % of portfolio)
 *   • Take profit mode    (strategy / fixed % / ATR multiple / risk:reward)
 *   • Stop loss mode      (strategy / fixed % / ATR multiple)
 *   • Trade controls      (max positions, cooldown, daily limits)
 *
 * All changes are SSE-logged on the server side ([TradingParams] prefix).
 */

import { useState, useEffect, useCallback } from "react";
import { SERVER_URL } from "../config/urls";

// ─── Types ────────────────────────────────────────────────────────────────────

type PositionSizeMode = "fixed_usdt" | "pct_portfolio" | "auto_risk";
type TakeProfitMode   = "strategy" | "fixed_pct" | "atr_multiple" | "risk_reward";
type StopLossMode     = "strategy" | "fixed_pct" | "atr";
type MarketRegime     = "any" | "bull" | "bear" | "range";

interface TradingParamsConfig {
  positionSizeMode:  PositionSizeMode;
  fixedSizeUsdt:     number;
  portfolioSizePct:  number;
  riskPerTradePct:   number;
  takeProfitMode:    TakeProfitMode;
  fixedTpPct:        number;
  tpAtrMultiple:     number;
  tpRiskReward:      number;
  stopLossMode:      StopLossMode;
  fixedSlPct:        number;
  slAtrMultiple:     number;
  maxOpenPositions:  number;
  maxDailyLossUsd:   number;
  maxTradesPerDay:   number;
  tradeCooldownMs:   number;
  // Phase 13 — Trade Filters
  minConfidence:     number;
  minAtr:            number;
  minVolumeRatio:    number;
  minTrendStrength:  number;
  maxSpreadPct:      number;
  maxVolatilityPct:  number;
  marketRegime:      MarketRegime;
  // Phase 13 — Risk Controls
  maxWinsPerDay:     number;
  maxLossesPerDay:   number;
  maxDrawdownPct:    number;
  maxDailyProfitUsd: number;
  pauseAfterLosses:  number;
  pauseAfterWins:    number;
  resumeNextDay:     boolean;
  // Phase 13 — Trade Management toggles
  trailingStopEnabled:  boolean;
  breakevenEnabled:     boolean;
  partialTpEnabled:     boolean;
  scaleInEnabled:       boolean;
  scaleOutEnabled:      boolean;
  profitLockEnabled:    boolean;
  timeExitEnabled:      boolean;
  momentumExitEnabled:  boolean;
}

interface TradingParamsPanelProps {
  disabled?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function authHeaders(): Record<string, string> {
  const jwt = localStorage.getItem("pcb_jwt");
  return jwt ? { Authorization: `Bearer ${jwt}` } : {};
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionCard({ title, badge, children }: {
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-gray-900 border border-gray-700/80 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-white font-bold text-sm">{title}</p>
        {badge}
      </div>
      {children}
    </div>
  );
}

function ModeBadge({ label, color }: { label: string; color: "cyan" | "purple" | "green" | "yellow" | "orange" }) {
  const colors = {
    cyan:   "bg-cyan-500/15 border-cyan-500/30 text-cyan-400",
    purple: "bg-purple-500/15 border-purple-500/30 text-purple-400",
    green:  "bg-green-500/15 border-green-500/30 text-green-400",
    yellow: "bg-yellow-500/15 border-yellow-500/30 text-yellow-400",
    orange: "bg-orange-500/15 border-orange-500/30 text-orange-400",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs border font-medium ${colors[color]}`}>
      {label}
    </span>
  );
}

function PresetRow<T extends string | number>({
  options,
  value,
  onSelect,
  disabled,
  format,
}: {
  options: { label: string; value: T }[];
  value: T;
  onSelect: (v: T) => void;
  disabled?: boolean;
  format?: (v: T) => string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const isActive = opt.value === value || (format && format(opt.value) === format(value));
        return (
          <button
            key={String(opt.value)}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(opt.value)}
            className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
              isActive
                ? "bg-cyan-500/20 border-cyan-500/50 text-cyan-300"
                : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function NumericInput({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="text-gray-500 text-xs block mb-1">{label}</label>
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-24 bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-white text-sm focus:outline-none focus:border-cyan-500 disabled:opacity-40"
        />
        {suffix && <span className="text-gray-500 text-xs">{suffix}</span>}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TradingParamsPanel({ disabled = false }: TradingParamsPanelProps) {
  const [cfg,     setCfg]     = useState<TradingParamsConfig | null>(null);
  const [form,    setForm]    = useState<TradingParamsConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // ── Fetch config ────────────────────────────────────────────────────────
  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch(`${SERVER_URL}/api/trading-params/config`, {
        headers: authHeaders(),
      });
      const data = await res.json() as { ok: boolean; config: TradingParamsConfig };
      if (data.ok) {
        setCfg(data.config);
        setForm(data.config);
        setError(null);
      }
    } catch {
      setError("Cannot reach server");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchConfig(); }, [fetchConfig]);

  // ── Form helpers ────────────────────────────────────────────────────────
  function patch<K extends keyof TradingParamsConfig>(key: K, val: TradingParamsConfig[K]) {
    setForm((f) => f ? { ...f, [key]: val } : f);
  }

  const isDirty = form && cfg && JSON.stringify(form) !== JSON.stringify(cfg);

  // ── Save ────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${SERVER_URL}/api/trading-params/config`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body:    JSON.stringify(form),
      });
      const data = await res.json() as { ok: boolean; config: TradingParamsConfig; error?: string };
      if (data.ok) {
        setCfg(data.config);
        setForm(data.config);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } else {
        setError(data.error ?? "Save failed");
      }
    } catch {
      setError("Network error — check server connection");
    } finally {
      setSaving(false);
    }
  };

  // ── Reset to server state ───────────────────────────────────────────────
  const handleReset = () => { if (cfg) setForm({ ...cfg }); };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <span className="text-gray-600 text-sm animate-pulse">Loading trade parameters…</span>
      </div>
    );
  }

  if (!form) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">
        {error ?? "Failed to load config — is the API server running?"}
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-white font-bold">⚙️ Trade Parameters</h3>
          <p className="text-gray-500 text-xs mt-0.5">
            Configuration authority · Position sizing · SL/TP modes · Trade controls · Trade filters · Risk controls
          </p>
        </div>

        <div className="flex items-center gap-2">
          {saved && (
            <span className="text-green-400 text-xs font-medium animate-pulse">✓ Runtime Updated</span>
          )}
          {error && (
            <span className="text-red-400 text-xs">{error}</span>
          )}
          {isDirty && (
            <button
              type="button"
              onClick={handleReset}
              disabled={saving}
              className="px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 text-xs hover:border-gray-500 disabled:opacity-40 transition-all"
            >
              Reset
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={disabled || saving || !isDirty}
            className="px-4 py-1.5 rounded-lg border border-cyan-500/50 bg-cyan-500/10 text-cyan-300 text-xs font-semibold hover:bg-cyan-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? "Saving…" : "Apply Changes"}
          </button>
        </div>
      </div>

      {/* ── 1. Position Sizing ─────────────────────────────────────────────── */}
      <SectionCard
        title="📐 Position Sizing"
        badge={
          form.positionSizeMode === "auto_risk"    ? <ModeBadge label="Auto Risk" color="cyan" />
          : form.positionSizeMode === "fixed_usdt"  ? <ModeBadge label="Fixed USDT" color="purple" />
          : <ModeBadge label="% Portfolio" color="green" />
        }
      >
        <PresetRow<PositionSizeMode>
          options={[
            { value: "auto_risk",     label: "🎯 Auto Risk" },
            { value: "fixed_usdt",    label: "💵 Fixed USDT" },
            { value: "pct_portfolio", label: "📊 % Portfolio" },
          ]}
          value={form.positionSizeMode}
          onSelect={(v) => patch("positionSizeMode", v)}
          disabled={disabled}
        />

        {form.positionSizeMode === "auto_risk" && (
          <div className="space-y-2">
            <p className="text-gray-600 text-xs">
              Risk a fixed % of balance per trade. Position size = riskAmount ÷ SL distance.
              Smaller size when SL is wide (higher volatility).
            </p>
            <div>
              <label className="text-gray-500 text-xs block mb-1.5">Risk Per Trade</label>
              <PresetRow<number>
                options={[
                  { value: 0.0025, label: "0.25%" },
                  { value: 0.005,  label: "0.5%"  },
                  { value: 0.01,   label: "1%"    },
                  { value: 0.02,   label: "2%"    },
                  { value: 0.03,   label: "3%"    },
                ]}
                value={form.riskPerTradePct}
                onSelect={(v) => patch("riskPerTradePct", v)}
                disabled={disabled}
                format={(v) => v.toFixed(4)}
              />
            </div>
            <NumericInput
              label="Custom risk %"
              value={+(form.riskPerTradePct * 100).toFixed(2)}
              min={0.25} max={5} step={0.25} suffix="%"
              onChange={(v) => patch("riskPerTradePct", v / 100)}
              disabled={disabled}
            />
          </div>
        )}

        {form.positionSizeMode === "fixed_usdt" && (
          <div className="space-y-2">
            <p className="text-gray-600 text-xs">
              Always use the same USDT amount per trade regardless of account size.
            </p>
            <div>
              <label className="text-gray-500 text-xs block mb-1.5">Fixed Trade Amount</label>
              <PresetRow<number>
                options={[
                  { value: 5,   label: "$5"   },
                  { value: 10,  label: "$10"  },
                  { value: 25,  label: "$25"  },
                  { value: 50,  label: "$50"  },
                  { value: 100, label: "$100" },
                  { value: 250, label: "$250" },
                  { value: 500, label: "$500" },
                ]}
                value={form.fixedSizeUsdt}
                onSelect={(v) => patch("fixedSizeUsdt", v)}
                disabled={disabled}
                format={(v) => String(v)}
              />
            </div>
            <NumericInput
              label="Custom amount"
              value={form.fixedSizeUsdt}
              min={5} max={10000} step={5} suffix="USDT"
              onChange={(v) => patch("fixedSizeUsdt", v)}
              disabled={disabled}
            />
          </div>
        )}

        {form.positionSizeMode === "pct_portfolio" && (
          <div className="space-y-2">
            <p className="text-gray-600 text-xs">
              Scale position size with account balance. Compounds gains and losses proportionally.
            </p>
            <div>
              <label className="text-gray-500 text-xs block mb-1.5">Portfolio %</label>
              <PresetRow<number>
                options={[
                  { value: 0.01,  label: "1%"  },
                  { value: 0.02,  label: "2%"  },
                  { value: 0.05,  label: "5%"  },
                  { value: 0.10,  label: "10%" },
                  { value: 0.20,  label: "20%" },
                ]}
                value={form.portfolioSizePct}
                onSelect={(v) => patch("portfolioSizePct", v)}
                disabled={disabled}
                format={(v) => v.toFixed(3)}
              />
            </div>
            <NumericInput
              label="Custom %"
              value={+(form.portfolioSizePct * 100).toFixed(1)}
              min={0.1} max={50} step={0.5} suffix="%"
              onChange={(v) => patch("portfolioSizePct", v / 100)}
              disabled={disabled}
            />
          </div>
        )}
      </SectionCard>

      {/* ── 2. Take Profit ─────────────────────────────────────────────────── */}
      <SectionCard
        title="✅ Take Profit"
        badge={
          form.takeProfitMode === "strategy"     ? <ModeBadge label="Strategy" color="cyan" />
          : form.takeProfitMode === "fixed_pct"  ? <ModeBadge label="Fixed %" color="green" />
          : form.takeProfitMode === "atr_multiple" ? <ModeBadge label="ATR ×" color="yellow" />
          : <ModeBadge label="R:R Ratio" color="orange" />
        }
      >
        <PresetRow<TakeProfitMode>
          options={[
            { value: "strategy",     label: "🤖 Strategy"   },
            { value: "fixed_pct",    label: "📌 Fixed %"    },
            { value: "atr_multiple", label: "📡 ATR ×"      },
            { value: "risk_reward",  label: "⚖️ R:R Ratio"  },
          ]}
          value={form.takeProfitMode}
          onSelect={(v) => patch("takeProfitMode", v)}
          disabled={disabled}
        />

        {form.takeProfitMode === "strategy" && (
          <p className="text-gray-600 text-xs">
            Strategy signals supply ATR-based TP. Falls back to the Fixed % TP from Bot Config
            when the strategy doesn't provide one.
          </p>
        )}

        {form.takeProfitMode === "fixed_pct" && (
          <div className="space-y-2">
            <p className="text-gray-600 text-xs">Override strategy TP with a constant percentage target.</p>
            <div>
              <label className="text-gray-500 text-xs block mb-1.5">Fixed TP %</label>
              <PresetRow<number>
                options={[
                  { value: 0.005, label: "0.5%" },
                  { value: 0.008, label: "0.8%" },
                  { value: 0.010, label: "1.0%" },
                  { value: 0.015, label: "1.5%" },
                  { value: 0.020, label: "2.0%" },
                  { value: 0.030, label: "3.0%" },
                ]}
                value={form.fixedTpPct}
                onSelect={(v) => patch("fixedTpPct", v)}
                disabled={disabled}
                format={(v) => v.toFixed(4)}
              />
            </div>
            <NumericInput
              label="Custom TP %"
              value={+(form.fixedTpPct * 100).toFixed(3)}
              min={0.1} max={50} step={0.1} suffix="%"
              onChange={(v) => patch("fixedTpPct", v / 100)}
              disabled={disabled}
            />
          </div>
        )}

        {form.takeProfitMode === "atr_multiple" && (
          <div className="space-y-2">
            <p className="text-gray-600 text-xs">
              TP = ATR × multiplier. Adapts to market volatility automatically.
              Higher ATR → wider TP target.
            </p>
            <div>
              <label className="text-gray-500 text-xs block mb-1.5">ATR Multiplier</label>
              <PresetRow<number>
                options={[
                  { value: 1.5, label: "1.5×" },
                  { value: 2.0, label: "2.0×" },
                  { value: 2.5, label: "2.5×" },
                  { value: 3.0, label: "3.0×" },
                  { value: 4.0, label: "4.0×" },
                  { value: 5.0, label: "5.0×" },
                ]}
                value={form.tpAtrMultiple}
                onSelect={(v) => patch("tpAtrMultiple", v)}
                disabled={disabled}
                format={(v) => String(v)}
              />
            </div>
            <NumericInput
              label="Custom multiplier"
              value={form.tpAtrMultiple}
              min={0.5} max={20} step={0.5} suffix="× ATR"
              onChange={(v) => patch("tpAtrMultiple", v)}
              disabled={disabled}
            />
          </div>
        )}

        {form.takeProfitMode === "risk_reward" && (
          <div className="space-y-2">
            <p className="text-gray-600 text-xs">
              TP = SL × R:R ratio. e.g. 2:1 means TP is always twice the SL distance.
              Maintains a consistent reward-to-risk on every trade.
            </p>
            <div>
              <label className="text-gray-500 text-xs block mb-1.5">Reward : Risk Ratio</label>
              <PresetRow<number>
                options={[
                  { value: 1.0, label: "1:1" },
                  { value: 1.5, label: "1.5:1" },
                  { value: 2.0, label: "2:1"   },
                  { value: 2.5, label: "2.5:1" },
                  { value: 3.0, label: "3:1"   },
                ]}
                value={form.tpRiskReward}
                onSelect={(v) => patch("tpRiskReward", v)}
                disabled={disabled}
                format={(v) => String(v)}
              />
            </div>
            <NumericInput
              label="Custom R:R"
              value={form.tpRiskReward}
              min={0.5} max={10} step={0.5} suffix=":1"
              onChange={(v) => patch("tpRiskReward", v)}
              disabled={disabled}
            />
          </div>
        )}
      </SectionCard>

      {/* ── 3. Stop Loss ───────────────────────────────────────────────────── */}
      <SectionCard
        title="🛑 Stop Loss"
        badge={
          form.stopLossMode === "strategy"  ? <ModeBadge label="Strategy" color="cyan" />
          : form.stopLossMode === "fixed_pct" ? <ModeBadge label="Fixed %" color="green" />
          : <ModeBadge label="ATR ×" color="yellow" />
        }
      >
        <PresetRow<StopLossMode>
          options={[
            { value: "strategy",  label: "🤖 Strategy" },
            { value: "fixed_pct", label: "📌 Fixed %"  },
            { value: "atr",       label: "📡 ATR ×"    },
          ]}
          value={form.stopLossMode}
          onSelect={(v) => patch("stopLossMode", v)}
          disabled={disabled}
        />

        {form.stopLossMode === "strategy" && (
          <p className="text-gray-600 text-xs">
            Strategy signals provide ATR-based SL placement. Falls back to the
            Fixed % SL from Bot Config when the strategy doesn't provide one.
          </p>
        )}

        {form.stopLossMode === "fixed_pct" && (
          <div className="space-y-2">
            <p className="text-gray-600 text-xs">
              Override strategy SL with a constant percentage stop. Consistent but
              ignores market volatility.
            </p>
            <div>
              <label className="text-gray-500 text-xs block mb-1.5">Fixed SL %</label>
              <PresetRow<number>
                options={[
                  { value: 0.005,  label: "0.5%"  },
                  { value: 0.0075, label: "0.75%" },
                  { value: 0.009,  label: "0.9%"  },
                  { value: 0.010,  label: "1.0%"  },
                  { value: 0.015,  label: "1.5%"  },
                  { value: 0.020,  label: "2.0%"  },
                ]}
                value={form.fixedSlPct}
                onSelect={(v) => patch("fixedSlPct", v)}
                disabled={disabled}
                format={(v) => v.toFixed(4)}
              />
            </div>
            <NumericInput
              label="Custom SL %"
              value={+(form.fixedSlPct * 100).toFixed(3)}
              min={0.1} max={20} step={0.1} suffix="%"
              onChange={(v) => patch("fixedSlPct", v / 100)}
              disabled={disabled}
            />
          </div>
        )}

        {form.stopLossMode === "atr" && (
          <div className="space-y-2">
            <p className="text-gray-600 text-xs">
              SL = ATR × multiplier. Adapts to volatility — wider stop in choppy
              markets, tighter in calm conditions.
            </p>
            <div>
              <label className="text-gray-500 text-xs block mb-1.5">ATR Multiplier</label>
              <PresetRow<number>
                options={[
                  { value: 1.0,  label: "1.0×" },
                  { value: 1.25, label: "1.25×" },
                  { value: 1.5,  label: "1.5×"  },
                  { value: 2.0,  label: "2.0×"  },
                  { value: 2.5,  label: "2.5×"  },
                ]}
                value={form.slAtrMultiple}
                onSelect={(v) => patch("slAtrMultiple", v)}
                disabled={disabled}
                format={(v) => String(v)}
              />
            </div>
            <NumericInput
              label="Custom multiplier"
              value={form.slAtrMultiple}
              min={0.25} max={10} step={0.25} suffix="× ATR"
              onChange={(v) => patch("slAtrMultiple", v)}
              disabled={disabled}
            />
          </div>
        )}
      </SectionCard>

      {/* ── 4. Trade Controls ──────────────────────────────────────────────── */}
      <SectionCard title="🎛️ Trade Controls">

        {/* Max Open Positions */}
        <div>
          <p className="text-gray-400 text-xs font-semibold mb-1.5">Max Open Positions</p>
          <div className="flex items-center gap-3">
            <PresetRow<number>
              options={[
                { value: 1, label: "1" },
                { value: 2, label: "2" },
                { value: 3, label: "3" },
                { value: 5, label: "5" },
              ]}
              value={form.maxOpenPositions}
              onSelect={(v) => patch("maxOpenPositions", v)}
              disabled={disabled}
              format={(v) => String(v)}
            />
            <NumericInput
              label=""
              value={form.maxOpenPositions}
              min={1} max={20} step={1}
              onChange={(v) => patch("maxOpenPositions", v)}
              disabled={disabled}
            />
          </div>
          <p className="text-gray-600 text-xs mt-1">
            Positions across all symbols. 1 = conservative single-position mode.
          </p>
        </div>

        {/* Trade Cooldown */}
        <div>
          <p className="text-gray-400 text-xs font-semibold mb-1.5">Trade Cooldown</p>
          <PresetRow<number>
            options={[
              { value: 0,       label: "None"  },
              { value: 30_000,  label: "30s"   },
              { value: 60_000,  label: "1m"    },
              { value: 300_000, label: "5m"    },
              { value: 900_000, label: "15m"   },
              { value: 1_800_000, label: "30m" },
            ]}
            value={form.tradeCooldownMs}
            onSelect={(v) => patch("tradeCooldownMs", v)}
            disabled={disabled}
            format={(v) => String(v)}
          />
          <p className="text-gray-600 text-xs mt-1">
            Minimum wait between trade entries. Prevents overtrading after a loss.
          </p>
        </div>

        {/* Max Trades Per Day */}
        <div>
          <p className="text-gray-400 text-xs font-semibold mb-1.5">Max Trades / Day</p>
          <div className="flex items-center gap-3">
            <PresetRow<number>
              options={[
                { value: 5,   label: "5"   },
                { value: 10,  label: "10"  },
                { value: 20,  label: "20"  },
                { value: 50,  label: "50"  },
                { value: 100, label: "100" },
              ]}
              value={form.maxTradesPerDay}
              onSelect={(v) => patch("maxTradesPerDay", v)}
              disabled={disabled}
              format={(v) => String(v)}
            />
            <NumericInput
              label=""
              value={form.maxTradesPerDay}
              min={1} max={200} step={1} suffix="trades"
              onChange={(v) => patch("maxTradesPerDay", v)}
              disabled={disabled}
            />
          </div>
        </div>

        {/* Max Daily Loss */}
        <div>
          <p className="text-gray-400 text-xs font-semibold mb-1.5">Max Daily Loss (halt threshold)</p>
          <div className="flex items-center gap-3">
            <PresetRow<number>
              options={[
                { value: -25,  label: "-$25"  },
                { value: -50,  label: "-$50"  },
                { value: -100, label: "-$100" },
                { value: -200, label: "-$200" },
                { value: -500, label: "-$500" },
              ]}
              value={form.maxDailyLossUsd}
              onSelect={(v) => patch("maxDailyLossUsd", v)}
              disabled={disabled}
              format={(v) => String(v)}
            />
            <NumericInput
              label=""
              value={Math.abs(form.maxDailyLossUsd)}
              min={1} max={10000} step={5} suffix="USD loss"
              onChange={(v) => patch("maxDailyLossUsd", -Math.abs(v))}
              disabled={disabled}
            />
          </div>
          <p className="text-gray-600 text-xs mt-1">
            Bot halts trading when daily P&amp;L drops below this level.
            Resumes the next UTC day.
          </p>
        </div>
      </SectionCard>

      {/* ── 5. Trade Filters ──────────────────────────────────────────────── */}
      <SectionCard title="🔍 Trade Filters" badge={<ModeBadge label="Quality Gate" color="purple" />}>
        <p className="text-gray-600 text-xs">
          Only trades meeting ALL filter criteria below will be considered for entry. Filters run before any position is opened.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <NumericInput
            label="Min Confidence (%)"
            value={form.minConfidence ?? 60}
            min={0} max={100} step={5} suffix="%"
            onChange={(v) => patch("minConfidence" as keyof TradingParamsConfig, v)}
            disabled={disabled}
          />
          <NumericInput
            label="Min ATR Value"
            value={form.minAtr ?? 0}
            min={0} max={1000} step={1} suffix="pts"
            onChange={(v) => patch("minAtr" as keyof TradingParamsConfig, v)}
            disabled={disabled}
          />
          <NumericInput
            label="Min Volume Ratio"
            value={form.minVolumeRatio ?? 1.0}
            min={0.1} max={10} step={0.1} suffix="×"
            onChange={(v) => patch("minVolumeRatio" as keyof TradingParamsConfig, v)}
            disabled={disabled}
          />
          <NumericInput
            label="Min Trend Strength"
            value={form.minTrendStrength ?? 0}
            min={0} max={100} step={5} suffix="pts"
            onChange={(v) => patch("minTrendStrength" as keyof TradingParamsConfig, v)}
            disabled={disabled}
          />
          <NumericInput
            label="Max Spread (%)"
            value={form.maxSpreadPct ?? 0.1}
            min={0.01} max={2} step={0.01} suffix="%"
            onChange={(v) => patch("maxSpreadPct" as keyof TradingParamsConfig, v)}
            disabled={disabled}
          />
          <NumericInput
            label="Max Volatility (%)"
            value={form.maxVolatilityPct ?? 5}
            min={0.1} max={50} step={0.5} suffix="%"
            onChange={(v) => patch("maxVolatilityPct" as keyof TradingParamsConfig, v)}
            disabled={disabled}
          />
        </div>

        <div>
          <p className="text-gray-500 text-xs font-semibold mb-2">Market Regime</p>
          <PresetRow<MarketRegime>
            options={[
              { value: "any",   label: "🌐 Any" },
              { value: "bull",  label: "🐂 Bull" },
              { value: "bear",  label: "🐻 Bear" },
              { value: "range", label: "📦 Range" },
            ]}
            value={form.marketRegime ?? "any"}
            onSelect={(v) => patch("marketRegime" as keyof TradingParamsConfig, v)}
            disabled={disabled}
            format={(v) => String(v)}
          />
          <p className="text-gray-600 text-xs mt-1">
            Only enter trades when the detected regime matches. "Any" bypasses regime filtering.
          </p>
        </div>
      </SectionCard>

      {/* ── 6. Risk Controls ──────────────────────────────────────────────── */}
      <SectionCard title="🛡️ Risk Controls" badge={<ModeBadge label="Session Limits" color="orange" />}>
        <p className="text-gray-600 text-xs">
          Session-level guardrails. Bot pauses automatically when limits are hit; trading resumes the next UTC day.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <p className="text-gray-400 text-xs font-semibold mb-1.5">Max Wins / Day</p>
            <div className="flex items-center gap-2">
              <PresetRow<number>
                options={[{ value: 5, label: "5" }, { value: 10, label: "10" }, { value: 20, label: "20" }, { value: 50, label: "50" }]}
                value={form.maxWinsPerDay ?? 20}
                onSelect={(v) => patch("maxWinsPerDay" as keyof TradingParamsConfig, v)}
                disabled={disabled}
                format={(v) => String(v)}
              />
            </div>
          </div>

          <div>
            <p className="text-gray-400 text-xs font-semibold mb-1.5">Max Losses / Day</p>
            <div className="flex items-center gap-2">
              <PresetRow<number>
                options={[{ value: 2, label: "2" }, { value: 3, label: "3" }, { value: 5, label: "5" }, { value: 10, label: "10" }]}
                value={form.maxLossesPerDay ?? 5}
                onSelect={(v) => patch("maxLossesPerDay" as keyof TradingParamsConfig, v)}
                disabled={disabled}
                format={(v) => String(v)}
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <NumericInput
            label="Max Drawdown (%)"
            value={form.maxDrawdownPct ?? 10}
            min={1} max={50} step={0.5} suffix="%"
            onChange={(v) => patch("maxDrawdownPct" as keyof TradingParamsConfig, v)}
            disabled={disabled}
          />
          <NumericInput
            label="Max Daily Profit (USD)"
            value={form.maxDailyProfitUsd ?? 0}
            min={0} max={100000} step={50} suffix="USD"
            onChange={(v) => patch("maxDailyProfitUsd" as keyof TradingParamsConfig, v)}
            disabled={disabled}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <p className="text-gray-400 text-xs font-semibold mb-1.5">Pause After X Losses</p>
            <PresetRow<number>
              options={[{ value: 0, label: "Off" }, { value: 2, label: "2" }, { value: 3, label: "3" }, { value: 5, label: "5" }]}
              value={form.pauseAfterLosses ?? 0}
              onSelect={(v) => patch("pauseAfterLosses" as keyof TradingParamsConfig, v)}
              disabled={disabled}
              format={(v) => String(v)}
            />
          </div>
          <div>
            <p className="text-gray-400 text-xs font-semibold mb-1.5">Pause After X Wins</p>
            <PresetRow<number>
              options={[{ value: 0, label: "Off" }, { value: 5, label: "5" }, { value: 10, label: "10" }, { value: 20, label: "20" }]}
              value={form.pauseAfterWins ?? 0}
              onSelect={(v) => patch("pauseAfterWins" as keyof TradingParamsConfig, v)}
              disabled={disabled}
              format={(v) => String(v)}
            />
          </div>
        </div>

        <div className="flex items-center gap-3 p-3 bg-gray-800/40 rounded-xl border border-gray-700/50">
          <button
            type="button"
            disabled={disabled}
            onClick={() => patch("resumeNextDay" as keyof TradingParamsConfig, !(form.resumeNextDay ?? true))}
            className={`w-10 h-6 rounded-full transition-all shrink-0 ${
              (form.resumeNextDay ?? true)
                ? "bg-cyan-500 shadow-[0_0_12px_rgba(6,182,212,0.4)]"
                : "bg-gray-700"
            }`}
          >
            <span className={`block w-4 h-4 rounded-full bg-white mx-auto transition-transform ${(form.resumeNextDay ?? true) ? "translate-x-2" : "-translate-x-2"}`} />
          </button>
          <div>
            <p className="text-gray-300 text-xs font-semibold">Auto-Resume Next Day</p>
            <p className="text-gray-600 text-[10px]">Bot automatically resumes trading at 00:00 UTC after a pause.</p>
          </div>
        </div>
      </SectionCard>

      {/* ── 7. Trade Management ────────────────────────────────────────────── */}
      <SectionCard title="🎯 Trade Management" badge={<ModeBadge label="Position Tools" color="green" />}>
        <p className="text-gray-600 text-xs">
          Enable or disable individual trade lifecycle features. Applies to all new positions.
        </p>

        {([
          { key: "trailingStopEnabled",  label: "📏 Trailing Stop",   desc: "Automatically moves SL up as price rises" },
          { key: "breakevenEnabled",     label: "⚖️ Breakeven",        desc: "Move SL to entry when target profit hit" },
          { key: "partialTpEnabled",     label: "📉 Partial TP",       desc: "Close 50% at first target, let rest run" },
          { key: "scaleInEnabled",       label: "📈 Scale In",         desc: "Add to winning positions (pyramid)" },
          { key: "scaleOutEnabled",      label: "📊 Scale Out",        desc: "Reduce position size as price extends" },
          { key: "profitLockEnabled",    label: "🔒 Profit Lock",      desc: "Lock minimum profit % once target hit" },
          { key: "timeExitEnabled",      label: "⏱️ Time Exit",         desc: "Exit automatically after max hold time" },
          { key: "momentumExitEnabled",  label: "💨 Momentum Exit",    desc: "Exit when momentum drops below threshold" },
        ] as { key: keyof TradingParamsConfig; label: string; desc: string }[]).map(({ key, label, desc }) => (
          <div key={String(key)} className="flex items-center gap-3 p-3 bg-gray-800/40 rounded-xl border border-gray-700/50 hover:border-gray-600/60 transition-colors">
            <button
              type="button"
              disabled={disabled}
              onClick={() => patch(key, !(form[key] as boolean))}
              className={`w-10 h-6 rounded-full transition-all shrink-0 ${
                form[key]
                  ? "bg-cyan-500 shadow-[0_0_12px_rgba(6,182,212,0.4)]"
                  : "bg-gray-700"
              }`}
            >
              <span className={`block w-4 h-4 rounded-full bg-white mx-auto transition-transform ${form[key] ? "translate-x-2" : "-translate-x-2"}`} />
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-gray-300 text-xs font-semibold">{label}</p>
              <p className="text-gray-600 text-[10px]">{desc}</p>
            </div>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
              form[key] ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/30" : "bg-gray-700 text-gray-500"
            }`}>
              {form[key] ? "ON" : "OFF"}
            </span>
          </div>
        ))}
      </SectionCard>

      {/* ── 8. Live Summary ────────────────────────────────────────────────── */}
      <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
        <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider mb-3">
          Active Configuration Summary
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
          <SummaryItem label="Size Mode"    value={form.positionSizeMode.replace("_", " ")} />
          <SummaryItem label="TP Mode"      value={form.takeProfitMode.replace("_", " ")} />
          <SummaryItem label="SL Mode"      value={form.stopLossMode.replace("_", " ")} />
          {form.positionSizeMode === "auto_risk" && (
            <SummaryItem label="Risk / Trade" value={`${(form.riskPerTradePct * 100).toFixed(2)}%`} />
          )}
          {form.positionSizeMode === "fixed_usdt" && (
            <SummaryItem label="Trade Size" value={`$${form.fixedSizeUsdt}`} />
          )}
          {form.positionSizeMode === "pct_portfolio" && (
            <SummaryItem label="Portfolio %" value={`${(form.portfolioSizePct * 100).toFixed(1)}%`} />
          )}
          {form.takeProfitMode === "fixed_pct" && (
            <SummaryItem label="Fixed TP" value={`${(form.fixedTpPct * 100).toFixed(2)}%`} />
          )}
          {form.takeProfitMode === "atr_multiple" && (
            <SummaryItem label="TP ATR ×" value={`${form.tpAtrMultiple}×`} />
          )}
          {form.takeProfitMode === "risk_reward" && (
            <SummaryItem label="R:R" value={`${form.tpRiskReward}:1`} />
          )}
          {form.stopLossMode === "fixed_pct" && (
            <SummaryItem label="Fixed SL" value={`${(form.fixedSlPct * 100).toFixed(2)}%`} />
          )}
          {form.stopLossMode === "atr" && (
            <SummaryItem label="SL ATR ×" value={`${form.slAtrMultiple}×`} />
          )}
          <SummaryItem label="Max Positions" value={String(form.maxOpenPositions)} />
          <SummaryItem label="Cooldown"      value={formatMs(form.tradeCooldownMs)} />
          <SummaryItem label="Daily Limit"   value={`-$${Math.abs(form.maxDailyLossUsd)}`} />
          <SummaryItem label="Max Trades"    value={`${form.maxTradesPerDay}/day`} />
        </div>
        {isDirty && (
          <p className="text-yellow-400/70 text-xs mt-3">
            ⚠ Unsaved changes — click "Apply Changes" to push to the bot.
          </p>
        )}
      </div>

    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-800/60 rounded-lg px-3 py-2">
      <p className="text-gray-600 text-[10px] uppercase tracking-wide">{label}</p>
      <p className="text-gray-200 text-xs font-semibold capitalize mt-0.5">{value}</p>
    </div>
  );
}

function formatMs(ms: number): string {
  if (ms === 0)         return "none";
  if (ms < 60_000)      return `${ms / 1000}s`;
  if (ms < 3_600_000)   return `${ms / 60_000}m`;
  return `${ms / 3_600_000}h`;
}
