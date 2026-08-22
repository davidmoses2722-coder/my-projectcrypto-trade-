/**
 * Strategy router — maps preset ID → strategy engine.
 *
 * ACTIVE strategies (paper + live):   active-swing, conservative-scalping
 * DISABLED strategies (signal = HOLD): swing, day-trading, scalping, dca, grid
 *
 * Phase 8.5: legacy Swing and Day-Trading disabled; only ActiveSwing and
 * ConservativeScalping v2 are production-ready for the $1,000 Growth account.
 */

import type { GenerateSignalInput, StrategySignal } from "../strategyService";

import * as Scalping             from "./ScalpingStrategy";
import * as DayTrading           from "./DayTradingStrategy";
import * as Swing                from "./SwingStrategy";
import * as ActiveSwing          from "./ActiveSwingStrategy";
import * as Dca                  from "./DcaStrategy";
import * as Grid                 from "./GridStrategy";
import * as ConservativeScalping from "./ConservativeScalpingStrategy";

export type StrategyId = "scalping" | "day-trading" | "swing" | "active-swing" | "dca" | "grid" | "conservative-scalping";

interface StrategyEntry {
  engineName: string;
  disabled:   boolean;
  fn: (input: GenerateSignalInput) => StrategySignal;
}

/**
 * Phase 8.5: Swing and Day-Trading disabled for Growth account optimisation.
 * Only ActiveSwing and ConservativeScalping v2.1 generate entries.
 * Grid/Scalping/DCA remain disabled as before.
 */
const DISABLED_STRATEGIES = new Set<string>(["scalping", "dca", "grid", "swing", "day-trading"]);

function disabledHold(name: string, _input: GenerateSignalInput): StrategySignal {
  return {
    action: "HOLD",
    confidence: 0,
    ema50: null, ema200: null, rsi: null, atr: null,
    currentVol: null, avgVol: null,
    suggestedSl: null, suggestedTp: null,
    stopLossPct: null, takeProfitPct: null,
    canTrade: false,
    blockReason: `${name} is disabled — Phase 8.5: only Active Swing and Conservative Scalping v2.1 are active`,
    conditions: null,
    reason: `${name} DISABLED`,
  };
}

const STRATEGY_MAP: Record<string, StrategyEntry> = {
  "scalping":              { engineName: Scalping.ENGINE_NAME,             disabled: true,  fn: Scalping.generateSignal             },
  "day-trading":           { engineName: DayTrading.ENGINE_NAME,           disabled: false, fn: DayTrading.generateSignal           },
  "swing":                 { engineName: Swing.ENGINE_NAME,                disabled: false, fn: Swing.generateSignal                },
  "active-swing":          { engineName: ActiveSwing.ENGINE_NAME,          disabled: false, fn: ActiveSwing.generateSignal          },
  "dca":                   { engineName: Dca.ENGINE_NAME,                  disabled: true,  fn: Dca.generateSignal                  },
  "grid":                  { engineName: Grid.ENGINE_NAME,                 disabled: true,  fn: Grid.generateSignal                 },
  "conservative-scalping": { engineName: ConservativeScalping.ENGINE_NAME, disabled: false, fn: ConservativeScalping.generateSignal },
};

/** Default engine when no strategy is set (Phase 8.5: active-swing) */
const DEFAULT_ID: StrategyId = "active-swing";

/**
 * Resolve a preset ID to its engine, guarding disabled strategies.
 * Falls back to SwingStrategy for unknown IDs.
 */
export function resolveStrategy(id: string): {
  engineName: string;
  disabled:   boolean;
  fn: (input: GenerateSignalInput) => StrategySignal;
} {
  const entry = STRATEGY_MAP[id] ?? STRATEGY_MAP[DEFAULT_ID]!;
  if (entry.disabled || DISABLED_STRATEGIES.has(id)) {
    return {
      engineName: entry.engineName,
      disabled:   true,
      fn: (input) => disabledHold(entry.engineName, input),
    };
  }
  return entry;
}

/** All registered strategy IDs */
export const STRATEGY_IDS = Object.keys(STRATEGY_MAP) as StrategyId[];

/** Active (non-disabled) strategy IDs */
export const ACTIVE_STRATEGY_IDS = STRATEGY_IDS.filter(id => !DISABLED_STRATEGIES.has(id));

/** Disabled strategy IDs */
export const DISABLED_STRATEGY_IDS = STRATEGY_IDS.filter(id => DISABLED_STRATEGIES.has(id));
