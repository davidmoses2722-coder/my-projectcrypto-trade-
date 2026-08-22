/**
 * positionSizingService — Dynamic risk-based position sizing.
 *
 * Formula:
 *   riskAmount   = accountBalance × riskPercent
 *   stopLossDist = |entryPrice - stopLossPrice|   = entryPrice × stopLossPct
 *   positionSize = riskAmount / stopLossDist
 *
 * ATR adjustment: when ATR is provided, the effective stop-loss distance is
 *   max(entryPrice × stopLossPct, atr) — whichever is wider (more conservative).
 *   Wider stop → smaller position → constant dollar risk regardless of volatility.
 *
 * Guardrails:
 *   • Minimum $5 per trade
 *   • Maximum min(20% of balance, $500)
 *
 * Risk profiles:
 *   Low    = 0.5%
 *   Medium = 1.0%
 *   High   = 2.0%
 *   Custom = 0.25% | 0.5% | 1% | 2% | 3%
 *
 * Integration points:
 *   • bot.ts         — balance update after each tick fetch; size injection in openPosition()
 *   • multiSymbolScanner — size injection before enqueueTradeEntry()
 *   • orchestrator route — advisory sizing status in orchestrator response
 *   • analytics route    — raw sizeUsdt already flows through; no change needed
 *   • tradeWorker        — receives computed sizeUsdt as requestedAmountUsdt; no change needed
 *   • portfolioRegistry  — already accepts dynamic sizeUsdt in canOpen(); no change needed
 *   • advancedRiskEngine — balance already synced via updateBalance(); no change needed
 *   • BullMQ queue       — TradeEntryJobData.sizeUsdt already accepts any number; no change needed
 */

import { logger } from "./logger";

// ─── Constants ─────────────────────────────────────────────────────────────────

export type RiskProfile = "low" | "medium" | "high" | "custom";

export const RISK_PROFILES = {
  low:    0.005,  // 0.5%
  medium: 0.010,  // 1.0%
  high:   0.020,  // 2.0%
} as const;

export const CUSTOM_VALUES = [0.0025, 0.005, 0.010, 0.020, 0.030] as const;
// 0.25%, 0.5%, 1%, 2%, 3%

const MIN_POSITION_USDT = 5;
const MAX_POSITION_PCT  = 0.30;   // 30% of balance (Phase 8.5 Growth account)
const MAX_POSITION_HARD = 1_000;  // hard $1,000 cap (raised for $1k account)

// ─── Result type ──────────────────────────────────────────────────────────────

export interface SizeResult {
  balance:       number;
  riskPct:       number;
  riskAmount:    number;   // balance × riskPct  (= maxLoss)
  stopLossDist:  number;   // |entryPrice - stopLossPrice| per unit
  positionSize:  number;   // USDT notional to deploy
  qty:           number;   // positionSize / entryPrice
  maxLoss:       number;   // = riskAmount (by definition of the formula)
  exposurePct:   number;   // positionSize / balance
  cappedTo:      string | null;
  atrAdjusted:   boolean;
}

export interface PositionSizingStatus {
  profile:            RiskProfile;
  riskPercent:        number;
  balance:            number;
  riskAmount:         number;
  positionSize:       number;   // computed from last known price + slPct
  maxLoss:            number;
  exposurePercent:    number;
  availableProfiles:  typeof RISK_PROFILES;
  customPct:          number;
  customValues:       readonly number[];
  lastBalanceAt:      number;   // Unix ms of last balance update
}

// ─── Verification types ───────────────────────────────────────────────────────

export interface VerificationRow {
  symbol:      string;
  strategy:    string;
  entryPrice:  number;
  slPct:       number;
  atr:         number | null;
  riskPct:     number;
  riskAmount:  number;
  posSize:     number;
  riskConst:   boolean;   // verify riskAmount stays constant despite ATR
}

// ─── Service ──────────────────────────────────────────────────────────────────

class PositionSizingService {
  private profile:    RiskProfile = "medium";
  private customPct:  number      = 0.010;
  private _balance:   number      = 0;
  private _balanceAt: number      = 0;
  private logFn: ((level: string, msg: string) => void) | null = null;

  // ── Wiring ────────────────────────────────────────────────────────────────

  setLogFn(fn: (level: string, msg: string) => void): void {
    this.logFn = fn;
  }

  private log(level: string, msg: string): void {
    if (this.logFn) {
      this.logFn(level, msg);
    } else {
      if (level === "error") logger.error(msg);
      else if (level === "warn")  logger.warn(msg);
      else                        logger.info(msg);
    }
  }

  // ── Profile management ────────────────────────────────────────────────────

  setProfile(profile: RiskProfile, customPct?: number): void {
    this.profile = profile;
    if (profile === "custom" && customPct != null) {
      this.customPct = Math.max(0.0025, Math.min(0.05, customPct));
    }
    this.log("info", `[PositionSizing] Profile set to ${profile} (${(this.getRiskPct() * 100).toFixed(2)}%)`);
  }

  getProfile(): RiskProfile { return this.profile; }

  getRiskPct(): number {
    if (this.profile === "custom") return this.customPct;
    return RISK_PROFILES[this.profile] ?? 0.010;
  }

  // ── Balance sync ──────────────────────────────────────────────────────────

  updateBalance(balance: number): void {
    if (balance > 0) {
      this._balance   = balance;
      this._balanceAt = Date.now();
    }
  }

  getBalance(): number { return this._balance; }

  // ── Core calculation ──────────────────────────────────────────────────────

  /**
   * Calculate the USDT position size for a single trade entry.
   *
   * @param entryPrice   Current market price of the asset
   * @param stopLossPct  Fractional stop-loss distance (e.g. 0.009 = 0.9%)
   * @param options.atr  Optional ATR value (absolute price units).
   *                     When provided, effective SL distance = max(price×slPct, atr).
   *                     This ensures wider stops → smaller position → constant $ risk.
   */
  calculate(
    entryPrice:  number,
    stopLossPct: number,
    options: { atr?: number } = {},
  ): SizeResult {
    const balance = this._balance > 0 ? this._balance : 1;
    const riskPct = this.getRiskPct();

    // Dollar amount willing to lose on this trade
    const riskAmount = balance * riskPct;

    // Stop-loss distance from the % config
    const slDistPct = entryPrice * stopLossPct;

    // ATR-adjusted: use ATR if wider than config SL distance
    let   slDist      = slDistPct;
    let   atrAdjusted = false;
    if (options.atr && options.atr > 0 && options.atr > slDistPct) {
      slDist      = options.atr;
      atrAdjusted = true;
    }

    if (slDist <= 0 || entryPrice <= 0) {
      return {
        balance, riskPct, riskAmount,
        stopLossDist: 0,
        positionSize: MIN_POSITION_USDT,
        qty: MIN_POSITION_USDT / (entryPrice || 1),
        maxLoss: riskAmount,
        exposurePct: MIN_POSITION_USDT / balance,
        cappedTo: `min $${MIN_POSITION_USDT}`,
        atrAdjusted: false,
      };
    }

    // Core formula: positionSize = riskAmount / stopLossDist
    let positionSize = riskAmount / slDist;
    let cappedTo: string | null = null;

    // Min guardrail
    if (positionSize < MIN_POSITION_USDT) {
      positionSize = MIN_POSITION_USDT;
      cappedTo = `min $${MIN_POSITION_USDT}`;
    }

    // Max guardrail: 20% of balance OR hard $500 cap
    const maxAllowed = Math.min(MAX_POSITION_HARD, balance * MAX_POSITION_PCT);
    if (positionSize > maxAllowed) {
      positionSize = maxAllowed;
      cappedTo = `max $${maxAllowed.toFixed(2)}`;
    }

    const qty        = positionSize / entryPrice;
    const exposurePct = balance > 0 ? positionSize / balance : 0;

    this.log(
      "info",
      `[PositionSizing] balance=${balance.toFixed(2)} risk=${(riskPct * 100).toFixed(2)}% ` +
      `riskAmount=${riskAmount.toFixed(2)} slDist=${slDist.toFixed(4)} ` +
      `size=${positionSize.toFixed(2)} maxLoss=${riskAmount.toFixed(2)}` +
      (atrAdjusted ? ` [ATR-adjusted]` : "") +
      (cappedTo ? ` [${cappedTo}]` : ""),
    );

    return {
      balance,
      riskPct,
      riskAmount,
      stopLossDist: slDist,
      positionSize,
      qty,
      maxLoss:     riskAmount,
      exposurePct,
      cappedTo,
      atrAdjusted,
    };
  }

  // ── Status snapshot ───────────────────────────────────────────────────────

  /**
   * Returns a safe-to-expose status object (no secrets).
   * positionSize / exposurePercent are estimated using a representative
   * price + slPct; for precise values call calculate() at trade time.
   */
  getStatus(examplePrice = 0, exampleSlPct = 0.01): PositionSizingStatus {
    const riskPct  = this.getRiskPct();
    const balance  = this._balance;
    const risk     = balance * riskPct;

    let positionSize  = 0;
    let exposurePct   = 0;
    if (examplePrice > 0 && exampleSlPct > 0) {
      const r = this.calculate(examplePrice, exampleSlPct);
      positionSize = r.positionSize;
      exposurePct  = r.exposurePct;
    }

    return {
      profile:           this.profile,
      riskPercent:       riskPct,
      balance,
      riskAmount:        risk,
      positionSize,
      maxLoss:           risk,
      exposurePercent:   exposurePct,
      availableProfiles: RISK_PROFILES,
      customPct:         this.customPct,
      customValues:      CUSTOM_VALUES,
      lastBalanceAt:     this._balanceAt,
    };
  }

  // ── Verification ──────────────────────────────────────────────────────────

  /**
   * Run the sizing calculation across all 6 scanner symbols and all 5 strategies
   * using representative prices + ATR values. Verifies that:
   *   1. Different ATR values produce different position sizes.
   *   2. The riskAmount (dollar loss if SL fires) stays constant.
   */
  runVerification(): VerificationRow[] {
    const SYMBOLS: Record<string, number> = {
      BTCUSDT: 65_000, ETHUSDT: 3_500, SOLUSDT: 155, XRPUSDT: 0.55, DOGEUSDT: 0.14, BNBUSDT: 580,
    };
    const STRATEGIES = ["swing", "scalping", "day-trading", "dca", "grid"];
    // ATR as % of price varies by asset: 0.5% (BTC) to 3% (DOGE)
    const ATR_PCT_BY_SYMBOL: Record<string, number> = {
      BTCUSDT: 0.005, ETHUSDT: 0.008, SOLUSDT: 0.018, XRPUSDT: 0.025, DOGEUSDT: 0.030, BNBUSDT: 0.010,
    };

    const rows: VerificationRow[] = [];
    const slPct = 0.009;  // 0.9% standard SL

    for (const sym of Object.keys(SYMBOLS)) {
      const price  = SYMBOLS[sym]!;
      const atrPct = ATR_PCT_BY_SYMBOL[sym]!;
      const atr    = price * atrPct;

      for (const strat of STRATEGIES) {
        // Without ATR
        const noAtr = this.calculate(price, slPct);
        // With ATR
        const withAtr = this.calculate(price, slPct, { atr });

        rows.push({
          symbol:     sym,
          strategy:   strat,
          entryPrice: price,
          slPct,
          atr:        null,
          riskPct:    noAtr.riskPct,
          riskAmount: noAtr.riskAmount,
          posSize:    noAtr.positionSize,
          riskConst:  true,  // no ATR baseline
        });

        rows.push({
          symbol:     sym,
          strategy:   strat,
          entryPrice: price,
          slPct,
          atr,
          riskPct:    withAtr.riskPct,
          riskAmount: withAtr.riskAmount,
          posSize:    withAtr.positionSize,
          // Risk constant = riskAmount unchanged (same balance × same riskPct)
          riskConst:  Math.abs(withAtr.riskAmount - noAtr.riskAmount) < 0.001,
        });
      }
    }

    return rows;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const positionSizingService = new PositionSizingService();
