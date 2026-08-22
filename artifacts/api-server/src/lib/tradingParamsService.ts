/**
 * tradingParamsService — Configuration Authority for all trade parameters.
 *
 * Single source of truth for:
 *   • Position size mode  (fixed USDT / % of portfolio / auto risk-based)
 *   • Take profit mode    (strategy / fixed % / ATR multiple / risk:reward)
 *   • Stop loss mode      (strategy / fixed % / ATR multiple)
 *   • Trade execution controls (max positions, cooldown, daily limits)
 *
 * resolve() is called by openPosition() in bot.ts with the live price,
 * strategy-suggested SL/TP, and ATR. It returns the final slPct, tpPct,
 * and sizeUsdt to use for that trade.
 *
 * Config is persisted via store.setSetting (key-value store) — no DB
 * migration required. Defaults preserve existing bot behaviour exactly.
 */

import * as store  from "./store";
import { logger }  from "./logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PositionSizeMode = "fixed_usdt" | "pct_portfolio" | "auto_risk";
export type TakeProfitMode   = "strategy" | "fixed_pct" | "atr_multiple" | "risk_reward";
export type StopLossMode     = "strategy" | "fixed_pct" | "atr";

export interface TradingParamsConfig {
  // Phase 14 schema marker. Used to migrate older saved configs safely.
  configVersion?: number;
  // ── Position sizing ───────────────────────────────────────────────────────
  positionSizeMode:   PositionSizeMode;
  fixedSizeUsdt:      number;   // mode=fixed_usdt  → use this amount directly
  portfolioSizePct:   number;   // mode=pct_portfolio → balance × pct  (e.g. 0.02 = 2%)
  riskPerTradePct:    number;   // mode=auto_risk
  maxPositionSizePct: number;   // hard per-trade balance cap   → risk pct of balance (e.g. 0.01 = 1%)

  // ── Take profit ───────────────────────────────────────────────────────────
  takeProfitMode:    TakeProfitMode;
  fixedTpPct:        number;    // mode=fixed_pct      (e.g. 0.010 = 1%)
  tpAtrMultiple:     number;    // mode=atr_multiple   (e.g. 3.0)
  tpRiskReward:      number;    // mode=risk_reward    (e.g. 2.0 → 2:1 R:R)

  // ── Stop loss ─────────────────────────────────────────────────────────────
  stopLossMode:      StopLossMode;
  fixedSlPct:        number;    // mode=fixed_pct  (e.g. 0.009 = 0.9%)
  slAtrMultiple:     number;    // mode=atr        (e.g. 1.5 × ATR)

  // ── Trade execution controls ──────────────────────────────────────────────
  maxOpenPositions:  number;
  maxDailyLossUsd:   number;    // negative, e.g. -50
  maxTradesPerDay:   number;
  tradeCooldownMs:   number;    // ms between trades
}

export interface ResolveInput {
  strategySlPct?:  number;   // ATR-based SL from strategy signal
  strategyTpPct?:  number;   // ATR-based TP from strategy signal
  configSlPct:     number;   // fallback from bot config.stopLoss
  configTpPct:     number;   // fallback from bot config.takeProfit
  configSizeUsdt:  number;   // fallback from bot config.orderSizeUsdt
  atr?:            number;   // current ATR in absolute price units
  balance:         number;   // current USDT balance
}

export interface ResolvedParams {
  slPct:      number;
  tpPct:      number;
  sizeUsdt:   number;
  slSource:   string;   // human-readable description for the log
  tpSource:   string;
  sizeSource: string;
}

// ─── Defaults (preserve existing behaviour exactly) ───────────────────────────

const SETTINGS_KEY = "trading_params_config";

export const DEFAULT_TRADING_PARAMS: TradingParamsConfig = {
  configVersion: 14,
  // Phase 14: explicit fixed sizing is the safe, predictable Bot Control default.
  // Users can switch to portfolio-% or auto-risk from the premium execution panel.
  positionSizeMode:  "fixed_usdt",
  fixedSizeUsdt:     25,
  portfolioSizePct:  0.02,
  riskPerTradePct:   0.01,
  maxPositionSizePct: 0.10,

  takeProfitMode:   "fixed_pct",
  fixedTpPct:       0.010,
  tpAtrMultiple:    3.0,
  tpRiskReward:     2.0,

  stopLossMode:     "fixed_pct",
  fixedSlPct:       0.009,
  slAtrMultiple:    1.5,

  maxOpenPositions:  2,
  maxDailyLossUsd:  -50,
  maxTradesPerDay:   20,
  tradeCooldownMs:   30_000,
};

// ─── Service ──────────────────────────────────────────────────────────────────

class TradingParamsService {
  private cfg: TradingParamsConfig = { ...DEFAULT_TRADING_PARAMS };
  private logFn: ((level: string, msg: string) => void) | null = null;

  // ── Wiring ────────────────────────────────────────────────────────────────

  setLogFn(fn: (level: string, msg: string) => void): void {
    this.logFn = fn;
  }

  private log(level: string, msg: string): void {
    if (this.logFn) this.logFn(level, msg);
    else if (level === "error") logger.error(msg);
    else if (level === "warn")  logger.warn(msg);
    else                        logger.info(msg);
  }

  // ── Config management ─────────────────────────────────────────────────────

  getConfig(): TradingParamsConfig { return { ...this.cfg }; }

  /**
   * Apply a partial patch to the config.
   * Each field is range-validated. Returns the full updated config.
   */
  updateConfig(patch: Partial<TradingParamsConfig>): TradingParamsConfig {
    const c = this.cfg;

    if (patch.positionSizeMode !== undefined)  c.positionSizeMode  = patch.positionSizeMode;
    if (patch.fixedSizeUsdt    !== undefined)  c.fixedSizeUsdt     = Math.max(5, patch.fixedSizeUsdt);
    if (patch.portfolioSizePct !== undefined)  c.portfolioSizePct  = Math.max(0.001, Math.min(0.50, patch.portfolioSizePct));
    if (patch.riskPerTradePct  !== undefined)  c.riskPerTradePct   = Math.max(0.0025, Math.min(0.05, patch.riskPerTradePct));
    if (patch.maxPositionSizePct !== undefined) c.maxPositionSizePct = Math.max(0.01, Math.min(0.95, patch.maxPositionSizePct));
    if (patch.takeProfitMode   !== undefined)  c.takeProfitMode    = patch.takeProfitMode;
    if (patch.fixedTpPct       !== undefined)  c.fixedTpPct        = Math.max(0.001, Math.min(0.50, patch.fixedTpPct));
    if (patch.tpAtrMultiple    !== undefined)  c.tpAtrMultiple     = Math.max(0.5, Math.min(20,  patch.tpAtrMultiple));
    if (patch.tpRiskReward     !== undefined)  c.tpRiskReward      = Math.max(0.5, Math.min(10,  patch.tpRiskReward));
    if (patch.stopLossMode     !== undefined)  c.stopLossMode      = patch.stopLossMode;
    if (patch.fixedSlPct       !== undefined)  c.fixedSlPct        = Math.max(0.001, Math.min(0.50, patch.fixedSlPct));
    if (patch.slAtrMultiple    !== undefined)  c.slAtrMultiple     = Math.max(0.25,  Math.min(10,  patch.slAtrMultiple));
    if (patch.maxOpenPositions !== undefined)  c.maxOpenPositions  = Math.max(1, Math.min(20,  patch.maxOpenPositions));
    if (patch.maxDailyLossUsd  !== undefined)  c.maxDailyLossUsd   = Math.min(-1, patch.maxDailyLossUsd);
    if (patch.maxTradesPerDay  !== undefined)  c.maxTradesPerDay   = Math.max(1, Math.min(200, patch.maxTradesPerDay));
    if (patch.tradeCooldownMs  !== undefined)  c.tradeCooldownMs   = Math.max(0, patch.tradeCooldownMs);

    // Build a concise log summary of what changed
    const parts: string[] = [];
    if (patch.positionSizeMode !== undefined) parts.push(`sizeMode=${c.positionSizeMode}`);
    if (patch.riskPerTradePct  !== undefined) parts.push(`riskPct=${(c.riskPerTradePct * 100).toFixed(2)}%`);
    if (patch.maxPositionSizePct !== undefined) parts.push(`maxPosition=${(c.maxPositionSizePct * 100).toFixed(1)}%`);
    if (patch.portfolioSizePct !== undefined) parts.push(`portfolioPct=${(c.portfolioSizePct * 100).toFixed(1)}%`);
    if (patch.fixedSizeUsdt    !== undefined) parts.push(`fixedUsdt=$${c.fixedSizeUsdt}`);
    if (patch.takeProfitMode   !== undefined) parts.push(`tpMode=${c.takeProfitMode}`);
    if (patch.fixedTpPct       !== undefined) parts.push(`fixedTp=${(c.fixedTpPct * 100).toFixed(2)}%`);
    if (patch.tpAtrMultiple    !== undefined) parts.push(`tpATR×${c.tpAtrMultiple}`);
    if (patch.tpRiskReward     !== undefined) parts.push(`R:R=${c.tpRiskReward}:1`);
    if (patch.stopLossMode     !== undefined) parts.push(`slMode=${c.stopLossMode}`);
    if (patch.fixedSlPct       !== undefined) parts.push(`fixedSl=${(c.fixedSlPct * 100).toFixed(2)}%`);
    if (patch.slAtrMultiple    !== undefined) parts.push(`slATR×${c.slAtrMultiple}`);
    if (patch.maxOpenPositions !== undefined) parts.push(`maxPos=${c.maxOpenPositions}`);
    if (patch.maxDailyLossUsd  !== undefined) parts.push(`dailyLoss=$${c.maxDailyLossUsd}`);
    if (patch.maxTradesPerDay  !== undefined) parts.push(`maxTrades=${c.maxTradesPerDay}`);
    if (patch.tradeCooldownMs  !== undefined) parts.push(`cooldown=${c.tradeCooldownMs / 1000}s`);

    if (parts.length > 0) {
      this.log("info", `[TradingParams] Config updated: ${parts.join(", ")}`);
    }

    void this.persist();
    return { ...c };
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  private async persist(): Promise<void> {
    try {
      await store.setSetting(SETTINGS_KEY, JSON.stringify(this.cfg));
    } catch (e) {
      logger.error({ err: e }, "tradingParamsService: persist failed");
    }
  }

  async hydrate(): Promise<void> {
    try {
      const raw = await store.getSetting(SETTINGS_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<TradingParamsConfig>;
      // Phase 14 migration: older builds persisted auto-risk sizing by default,
      // which is why users could unexpectedly see $5 positions. Upgrade those
      // legacy configs to an explicit fixed-size authority once, while preserving
      // the saved fixed amount when available.
      if (saved.configVersion !== 14) {
        saved.configVersion = 14;
        saved.positionSizeMode = "fixed_usdt";
        saved.fixedSizeUsdt = Math.max(5, Number(saved.fixedSizeUsdt ?? 25));
        logger.warn(
          { fixedSizeUsdt: saved.fixedSizeUsdt },
          "tradingParamsService: migrated legacy Phase 13 sizing to Phase 14 fixed-size authority",
        );
      }
      this.updateConfig(saved);
      logger.info("tradingParamsService: config restored from DB");
    } catch (e) {
      logger.warn({ err: e }, "tradingParamsService: hydrate failed — using defaults");
    }
  }

  // ── Core resolver ─────────────────────────────────────────────────────────

  /**
   * Compute effective SL%, TP%, and position USDT size for an upcoming trade.
   * Called once per openPosition() invocation in bot.ts.
   *
   * The auto_risk sizing formula mirrors positionSizingService.calculate():
   *   riskAmount   = balance × riskPerTradePct
   *   slDistPx     = max(price × slPct, atr)        ← ATR-adjusted if wider
   *   positionSize = riskAmount / slDistPx
   *   clamped to   [min $5, max min($1000, balance×30%)]
   */
  resolve(price: number, input: ResolveInput): ResolvedParams {
    const cfg = this.cfg;

    // ── Stop Loss ─────────────────────────────────────────────────────────

    let slPct:    number;
    let slSource: string;

    switch (cfg.stopLossMode) {
      case "fixed_pct":
        slPct    = cfg.fixedSlPct;
        slSource = `fixed-SL ${(slPct * 100).toFixed(2)}%`;
        break;

      case "atr":
        if (input.atr && input.atr > 0 && price > 0) {
          slPct    = (input.atr * cfg.slAtrMultiple) / price;
          slSource = `ATR×${cfg.slAtrMultiple} ${(slPct * 100).toFixed(2)}%`;
        } else {
          // No ATR available — fall back to strategy/config
          slPct    = input.strategySlPct ?? input.configSlPct;
          slSource = `ATR-SL fallback ${(slPct * 100).toFixed(2)}%`;
        }
        break;

      case "strategy":
      default:
        slPct    = input.strategySlPct ?? input.configSlPct;
        slSource = input.strategySlPct != null
          ? `strategy-SL ${(slPct * 100).toFixed(2)}%`
          : `config-SL ${(slPct * 100).toFixed(2)}%`;
        break;
    }

    // Clamp SL to [0.1%, 20%] as a safety net
    slPct = Math.max(0.001, Math.min(0.20, slPct));

    // ── Take Profit ───────────────────────────────────────────────────────

    let tpPct:    number;
    let tpSource: string;

    switch (cfg.takeProfitMode) {
      case "fixed_pct":
        tpPct    = cfg.fixedTpPct;
        tpSource = `fixed-TP ${(tpPct * 100).toFixed(2)}%`;
        break;

      case "atr_multiple":
        if (input.atr && input.atr > 0 && price > 0) {
          tpPct    = (input.atr * cfg.tpAtrMultiple) / price;
          tpSource = `ATR×${cfg.tpAtrMultiple} ${(tpPct * 100).toFixed(2)}%`;
        } else {
          tpPct    = input.strategyTpPct ?? input.configTpPct;
          tpSource = `ATR-TP fallback ${(tpPct * 100).toFixed(2)}%`;
        }
        break;

      case "risk_reward":
        tpPct    = slPct * cfg.tpRiskReward;
        tpSource = `R:R ${cfg.tpRiskReward}:1 → ${(tpPct * 100).toFixed(2)}%`;
        break;

      case "strategy":
      default:
        tpPct    = input.strategyTpPct ?? input.configTpPct;
        tpSource = input.strategyTpPct != null
          ? `strategy-TP ${(tpPct * 100).toFixed(2)}%`
          : `config-TP ${(tpPct * 100).toFixed(2)}%`;
        break;
    }

    // Clamp TP to [0.1%, 100%]
    tpPct = Math.max(0.001, Math.min(1.0, tpPct));

    // ── Position Size ─────────────────────────────────────────────────────

    const balance = input.balance > 0 ? input.balance : 1;
    let sizeUsdt:   number;
    let sizeSource: string;

    switch (cfg.positionSizeMode) {
      case "fixed_usdt":
        sizeUsdt   = Math.max(5, cfg.fixedSizeUsdt);
        sizeSource = `fixed $${sizeUsdt.toFixed(2)}`;
        break;

      case "pct_portfolio": {
        const raw    = balance * cfg.portfolioSizePct;
        sizeUsdt     = Math.max(5, Math.min(balance * 0.95, raw));
        sizeSource   = `${(cfg.portfolioSizePct * 100).toFixed(1)}% bal → $${sizeUsdt.toFixed(2)}`;
        break;
      }

      case "auto_risk":
      default: {
        // Replicate positionSizingService.calculate() formula inline so we
        // use our own riskPerTradePct without mutating the global service.
        const riskAmt   = balance * cfg.riskPerTradePct;
        const slDistPct = price * slPct;
        let   slDist    = slDistPct;
        if (input.atr && input.atr > 0 && input.atr > slDistPct) {
          slDist = input.atr;   // ATR-adjusted: wider stop → smaller position
        }
        let rawSize = slDist > 0 ? riskAmt / slDist : input.configSizeUsdt;
        rawSize = Math.max(5, Math.min(Math.min(1_000, balance * 0.30), rawSize));
        sizeUsdt   = rawSize;
        sizeSource = `risk ${(cfg.riskPerTradePct * 100).toFixed(2)}% → $${sizeUsdt.toFixed(2)}`;
        break;
      }
    }

    return { slPct, tpPct, sizeUsdt, slSource, tpSource, sizeSource };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const tradingParamsService = new TradingParamsService();
