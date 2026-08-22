/**
 * marketScannerService — scores approved trading symbols and selects the best opportunity.
 *
 * Uses the Gate.io public REST API (no API keys required).
 * Computes EMA50, EMA200, RSI(14), ADX(14), ATR(14), Bollinger Band width,
 * volume ratio, and spread, then applies hard-reject rules and a 100-point
 * scoring model to rank all approved symbols.
 */

import { logger }      from "../lib/logger";
import { validateATR } from "../lib/atrValidator";

const GATE_BASE      = "https://api.gateio.ws/api/v4";
const CANDLE_LIMIT   = 250;
const CANDLE_INTERVAL = "4h";
const ADX_PERIOD     = 14;
const RSI_PERIOD     = 14;
const ATR_PERIOD     = 14;
const EMA_FAST       = 50;
const EMA_SLOW       = 200;
const BB_PERIOD      = 20;
const VOL_PERIOD     = 20;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MarketScanResult {
  symbol:       string;        // Gate.io format, e.g. "BTC_USDT"
  score:        number;        // 0–100
  regime:       string;
  ema50:        number | null;
  ema200:       number | null;
  rsi:          number | null;
  adx:          number | null;
  atr:          number | null;
  atrPct:       number | null;
  volumeRatio:  number | null;
  spreadPct:    number | null;
  bbWidth:      number | null;
  selected:     boolean;
  rejected:     boolean;
  rejectReason: string | null;
  scannedAt:    string;
  error:        string | null;
}

export interface ScanReport {
  results:            MarketScanResult[];
  best:               MarketScanResult | null;
  scannedAt:          string;
  noQualifiedReason?: string;
}

interface Candle {
  time: number; open: number; high: number; low: number;
  close: number; volume: number;
}

// ─── Gate.io public fetchers ──────────────────────────────────────────────────

async function fetchCandles(symbol: string): Promise<Candle[]> {
  const url = `${GATE_BASE}/spot/candlesticks?currency_pair=${symbol}&interval=${CANDLE_INTERVAL}&limit=${CANDLE_LIMIT}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`Gate.io candles ${symbol}: HTTP ${res.status}`);
  const raw = await res.json() as string[][];
  return raw
    .map(r => ({
      time:   Number(r[0]) * 1000,
      open:   Number(r[5]),
      high:   Number(r[3]),
      low:    Number(r[4]),
      close:  Number(r[2]),
      volume: Number(r[6]),
    }))
    .sort((a, b) => a.time - b.time);
}

async function fetchSpread(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(
      `${GATE_BASE}/spot/tickers?currency_pair=${symbol}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) return null;
    const data = await res.json() as { highest_bid: string; lowest_ask: string }[];
    const t = data[0];
    if (!t) return null;
    const bid = Number(t.highest_bid), ask = Number(t.lowest_ask);
    if (!bid || !ask) return null;
    return (ask - bid) / ((bid + ask) / 2);
  } catch {
    return null;
  }
}

// ─── Indicator maths ─────────────────────────────────────────────────────────

function computeEMA(closes: number[], period: number): (number | null)[] {
  if (closes.length < period) return closes.map(() => null);
  const k = 2 / (period + 1);
  const out: (number | null)[] = closes.map(() => null);
  let ema = closes.slice(0, period).reduce((s, v) => s + v, 0) / period;
  out[period - 1] = ema;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i]! * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

function computeRSI(closes: number[], period = RSI_PERIOD): number | null {
  if (closes.length < period + 1) return null;
  const sl = closes.slice(-(period + 1));
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = sl[i]! - sl[i - 1]!;
    if (d > 0) gains += d; else losses -= d;
  }
  const ag = gains / period, al = losses / period;
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}

function computeATR(highs: number[], lows: number[], closes: number[], period = ATR_PERIOD): number | null {
  if (closes.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    trs.push(Math.max(
      highs[i]! - lows[i]!,
      Math.abs(highs[i]! - closes[i - 1]!),
      Math.abs(lows[i]!  - closes[i - 1]!),
    ));
  }
  return trs.slice(-period).reduce((s, v) => s + v, 0) / period;
}

function computeADX(highs: number[], lows: number[], closes: number[], period = ADX_PERIOD): number | null {
  if (closes.length < period * 2 + 1) return null;
  const trs: number[] = [], plusDMs: number[] = [], minusDMs: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const tr   = Math.max(highs[i]! - lows[i]!, Math.abs(highs[i]! - closes[i-1]!), Math.abs(lows[i]! - closes[i-1]!));
    const up   = highs[i]! - highs[i-1]!;
    const down = lows[i-1]! - lows[i]!;
    trs.push(tr);
    plusDMs.push(up > down && up > 0 ? up : 0);
    minusDMs.push(down > up && down > 0 ? down : 0);
  }
  // Wilder smoothing
  let smTR = trs.slice(0, period).reduce((s, v) => s + v, 0);
  let smP  = plusDMs.slice(0, period).reduce((s, v) => s + v, 0);
  let smM  = minusDMs.slice(0, period).reduce((s, v) => s + v, 0);
  const dxArr: number[] = [];
  for (let i = period; i < trs.length; i++) {
    smTR = smTR - smTR / period + trs[i]!;
    smP  = smP  - smP  / period + plusDMs[i]!;
    smM  = smM  - smM  / period + minusDMs[i]!;
    const diP = smTR > 0 ? 100 * smP / smTR : 0;
    const diM = smTR > 0 ? 100 * smM / smTR : 0;
    const sum = diP + diM;
    dxArr.push(sum > 0 ? 100 * Math.abs(diP - diM) / sum : 0);
  }
  if (dxArr.length < period) return null;
  let adx = dxArr.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < dxArr.length; i++) {
    adx = (adx * (period - 1) + dxArr[i]!) / period;
  }
  return adx;
}

function computeBBWidth(closes: number[], period = BB_PERIOD): number | null {
  if (closes.length < period) return null;
  const sl   = closes.slice(-period);
  const mean = sl.reduce((s, v) => s + v, 0) / period;
  const std  = Math.sqrt(sl.reduce((s, v) => s + (v - mean) ** 2, 0) / period);
  return mean > 0 ? (4 * std) / mean : null;   // (upper-lower)/mid = 4σ/μ
}

function computeVolumeRatio(vols: number[], period = VOL_PERIOD): number | null {
  if (vols.length < period + 1) return null;
  const avgVol = vols.slice(-period - 1, -1).reduce((s, v) => s + v, 0) / period;
  return avgVol > 0 ? vols[vols.length - 1]! / avgVol : null;
}

// ─── Regime detection ─────────────────────────────────────────────────────────

function detectRegime(ema50: number, ema200: number, adx: number, bbWidth: number): string {
  const trendUp = ema50 > ema200;
  if (adx >= 35) return trendUp ? "strong_trend" : "strong_downtrend";
  if (adx >= 25) {
    if (bbWidth > 0.04) return "breakout";
    return trendUp ? "weak_trend" : "weak_downtrend";
  }
  if (bbWidth > 0.06) return "volatility_expansion";
  if (bbWidth < 0.01) return "volatility_compression";
  return "range";
}

// ─── Hard reject rules ────────────────────────────────────────────────────────

function hardReject(
  adx: number | null, atrPct: number | null,
  spreadPct: number | null, regime: string,
): string | null {
  if (adx !== null && adx < 20)           return `ADX ${adx.toFixed(1)} < 20 (no trend)`;
  if (atrPct !== null && atrPct < 0.001)  return `ATR ${(atrPct*100).toFixed(3)}% < 0.1% (too quiet)`;
  if (spreadPct !== null && spreadPct > 0.0025)
    return `Spread ${(spreadPct*100).toFixed(3)}% > 0.25% (too wide)`;
  if (regime === "range")                  return "Regime: Range (blocked)";
  if (regime === "volatility_compression") return "Regime: Volatility compression (blocked)";
  return null;
}

// ─── Scoring model (max 100) ──────────────────────────────────────────────────

function scoreSymbol(
  regime:      string,
  ema50:       number | null,
  ema200:      number | null,
  rsi:         number | null,
  volumeRatio: number | null,
  atrPct:      number | null,
  spreadPct:   number | null,
): number {
  let score = 0;
  if (regime === "strong_trend")  score += 30;
  else if (regime === "breakout") score += 25;
  else if (regime === "weak_trend") score += 10;
  if (ema50 !== null && ema200 !== null && ema50 > ema200) score += 20;
  if (rsi !== null && rsi >= 35 && rsi <= 55)              score += 15;
  if (volumeRatio !== null && volumeRatio >= 1.0)          score += 15;
  if (atrPct !== null && atrPct >= 0.001 && atrPct <= 0.03) score += 10;
  if (spreadPct !== null) {
    if (spreadPct <= 0.001)       score += 10;
    else if (spreadPct <= 0.0025) score += 5;
  }
  return Math.min(score, 100);
}

// ─── Per-symbol scan ─────────────────────────────────────────────────────────

async function scanSymbol(symbol: string): Promise<MarketScanResult> {
  const base: MarketScanResult = {
    symbol, score: 0, regime: "unknown",
    ema50: null, ema200: null, rsi: null, adx: null,
    atr: null, atrPct: null, volumeRatio: null, spreadPct: null, bbWidth: null,
    selected: false, rejected: false, rejectReason: null,
    scannedAt: new Date().toISOString(), error: null,
  };

  try {
    const [candles, spreadPct] = await Promise.all([
      fetchCandles(symbol),
      fetchSpread(symbol),
    ]);

    if (candles.length < EMA_SLOW + 2) {
      return { ...base, rejected: true, rejectReason: `Only ${candles.length} candles (need ${EMA_SLOW + 2})`, error: "insufficient_data" };
    }

    const closes  = candles.map(c => c.close);
    const highs   = candles.map(c => c.high);
    const lows    = candles.map(c => c.low);
    const volumes = candles.map(c => c.volume);
    const last    = closes.length - 1;

    const ema50arr = computeEMA(closes, EMA_FAST);
    const ema200arr = computeEMA(closes, EMA_SLOW);
    const ema50       = ema50arr[last]  ?? null;
    const ema200      = ema200arr[last] ?? null;
    const rsi         = computeRSI(closes);
    const rawAtr      = computeATR(highs, lows, closes);
    const adx         = computeADX(highs, lows, closes);
    const bbWidth     = computeBBWidth(closes);
    const volumeRatio = computeVolumeRatio(volumes);
    const price       = closes[last]!;

    // Phase 12.1: validate ATR result — reject impossible values
    const atrResult   = validateATR(rawAtr, price, symbol, "4h");
    const atr         = atrResult.valid ? atrResult.atr   : null;
    const atrPct      = atrResult.valid ? atrResult.atrPct : null;

    const regime = (ema50 !== null && ema200 !== null && adx !== null && bbWidth !== null)
      ? detectRegime(ema50, ema200, adx, bbWidth)
      : "unknown";

    const rejectReason = hardReject(adx, atrPct, spreadPct, regime);
    if (rejectReason) {
      return { ...base, ema50, ema200, rsi, adx, atr, atrPct, volumeRatio, spreadPct, bbWidth, regime, rejected: true, rejectReason };
    }

    const score = scoreSymbol(regime, ema50, ema200, rsi, volumeRatio, atrPct, spreadPct);
    return { ...base, ema50, ema200, rsi, adx, atr, atrPct, volumeRatio, spreadPct, bbWidth, regime, score };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err, symbol }, "marketScannerService: scanSymbol error");
    return { ...base, rejected: true, rejectReason: "fetch_error", error: msg };
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function scanMarkets(
  approvedSymbols: string[],
  minimumScore:    number,
): Promise<ScanReport> {
  const scannedAt = new Date().toISOString();
  if (approvedSymbols.length === 0) {
    return { results: [], best: null, scannedAt, noQualifiedReason: "No approved symbols configured" };
  }

  const settled = await Promise.allSettled(approvedSymbols.map(scanSymbol));
  const results: MarketScanResult[] = settled.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return {
      symbol: approvedSymbols[i]!, score: 0, regime: "error",
      ema50: null, ema200: null, rsi: null, adx: null,
      atr: null, atrPct: null, volumeRatio: null, spreadPct: null, bbWidth: null,
      selected: false, rejected: true, rejectReason: "scan_error",
      scannedAt, error: r.reason instanceof Error ? r.reason.message : String(r.reason),
    };
  });

  results.sort((a, b) => {
    if (a.rejected && !b.rejected) return 1;
    if (!a.rejected && b.rejected) return -1;
    return b.score - a.score;
  });

  const qualified = results.filter(r => !r.rejected && r.score >= minimumScore);
  let best: MarketScanResult | null = null;
  let noQualifiedReason: string | undefined;

  if (qualified.length > 0) {
    best = qualified[0]!;
    best.selected = true;
  } else {
    const top = results.filter(r => !r.rejected);
    const maxScore = top.length > 0 ? Math.max(...top.map(r => r.score)) : 0;
    noQualifiedReason = `NO_QUALIFIED_MARKET — best score ${maxScore}/100 < minimum ${minimumScore}`;
  }

  logger.info({ count: results.length, best: best?.symbol, bestScore: best?.score }, "marketScannerService: scan complete");
  return { results, best, scannedAt, noQualifiedReason };
}
