/**
 * benchmarkHistoryConfig.ts — Single source of truth for all benchmark history windows.
 *
 * Gate.io enforces a hard limit of 10,000 candles per request.
 * We cap at 9,000 as a safety margin.
 *
 * To add a new strategy: add an entry here keyed by strategy ID.
 * benchmarkService.ts reads these values automatically.
 *
 * Calculations:
 *   4h  × 365 days = 365 × (24h ÷ 4h)  = 365 × 6  = 2,190 candles
 *   15m × 90 days  = 90  × (24h × 4/h)  = 90  × 96 = 8,640 candles
 */

export interface HistoryWindow {
  timeframe:  string;
  maxDays:    number;
  maxCandles: number;
  label:      string;   // human-readable: "365 days (4h)"
}

export const BENCHMARK_HISTORY_CONFIG: Record<string, HistoryWindow> = {
  "active-swing": {
    timeframe:  "4h",
    maxDays:    365,
    maxCandles: 2_190,
    label:      "365 days (4h)",
  },
  "conservative-scalping": {
    timeframe:  "15m",
    maxDays:    90,
    maxCandles: 8_640,
    label:      "90 days (15m)",
  },
};

/** Hard ceiling — Gate.io rejects requests for candles older than 10,000 points ago */
export const MAX_CANDLE_LIMIT = 9_000;
