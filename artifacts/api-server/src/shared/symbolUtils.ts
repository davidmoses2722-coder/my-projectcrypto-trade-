/**
 * symbolUtils.ts — Canonical symbol formatting utility
 *
 * Single source of truth for all symbol format conversions.
 *
 * Supported inputs:  BTCUSDT | BTC_USDT | BTC/USDT | btc_usdt | btcusdt
 *
 * Outputs:
 *   normalizeSymbol()  → BTCUSDT   (internal / bot.ts config)
 *   toGateApiSymbol()  → BTC_USDT  (Gate.io REST/WS, market scanner)
 *   toDisplaySymbol()  → BTC/USDT  (CCXT, Telegram display)
 *
 * Log format: [Symbol] Input=BTC/USDT → API=BTC_USDT → Internal=BTCUSDT
 */

import { logger } from "../lib/logger";

const KNOWN_QUOTES = ["USDT", "USDC", "USD", "BTC", "ETH", "BUSD", "EUR"] as const;

// Currencies that are ONLY used as quotes (never a valid base); used to detect inverted pairs
const STABLE_ONLY_QUOTES = ["USDT", "USDC", "USD", "BUSD", "EUR"] as const;

// ─── Error ────────────────────────────────────────────────────────────────────

export class InvalidSymbolError extends Error {
  constructor(public readonly originalInput: string) {
    super(`InvalidSymbolError: "${originalInput}"`);
    this.name = "InvalidSymbolError";
  }
}

// ─── Core: strip to BTCUSDT ───────────────────────────────────────────────────

export function normalizeSymbol(input: string): string {
  const raw = input.trim().toUpperCase();

  // Reject: double separators, leading/trailing separators, dashes
  if (/[_/]{2,}/.test(raw))                          throw new InvalidSymbolError(input);
  if (raw.startsWith("_") || raw.startsWith("/"))    throw new InvalidSymbolError(input);
  if (raw.endsWith("_")   || raw.endsWith("/"))      throw new InvalidSymbolError(input);
  if (raw.includes("-"))                              throw new InvalidSymbolError(input);

  // Strip all separators → BTCUSDT
  const stripped = raw.replace(/[_/]/g, "");

  if (!stripped || stripped.length < 4)              throw new InvalidSymbolError(input);

  const quote = (KNOWN_QUOTES as readonly string[]).find(
    q => stripped.endsWith(q) && stripped.length > q.length,
  );
  if (!quote)                                         throw new InvalidSymbolError(input);

  // Reject inverted pairs: USDT_BTC → stripped = USDTBTC → base = "USDT" (stable-only)
  // BTC/ETH are valid bases even though they appear in KNOWN_QUOTES; only reject stable currencies
  const base = stripped.slice(0, -quote.length);
  if ((STABLE_ONLY_QUOTES as readonly string[]).includes(base)) throw new InvalidSymbolError(input);

  return stripped; // e.g. BTCUSDT
}

// ─── Gate.io REST / WebSocket format ─────────────────────────────────────────

export function toGateApiSymbol(input: string): string {
  const n = normalizeSymbol(input);
  const q = (KNOWN_QUOTES as readonly string[]).find(q => n.endsWith(q))!;
  const b = n.slice(0, -q.length);
  const api = `${b}_${q}`;
  logger.debug(`[Symbol] Input=${input} → API=${api} → Internal=${n}`);
  return api;
}

// ─── CCXT / display format ────────────────────────────────────────────────────

export function toDisplaySymbol(input: string): string {
  const n = normalizeSymbol(input);
  const q = (KNOWN_QUOTES as readonly string[]).find(q => n.endsWith(q))!;
  const b = n.slice(0, -q.length);
  return `${b}/${q}`;
}
