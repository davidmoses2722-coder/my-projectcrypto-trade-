/**
 * symbolUtils.test.ts
 *
 * Run: pnpm --filter @workspace/api-server exec vitest run src/shared/symbolUtils.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  normalizeSymbol,
  toGateApiSymbol,
  toDisplaySymbol,
  InvalidSymbolError,
} from "./symbolUtils";

// ─── normalizeSymbol ──────────────────────────────────────────────────────────

describe("normalizeSymbol", () => {
  it("BTCUSDT → BTCUSDT",   () => expect(normalizeSymbol("BTCUSDT")).toBe("BTCUSDT"));
  it("BTC_USDT → BTCUSDT",  () => expect(normalizeSymbol("BTC_USDT")).toBe("BTCUSDT"));
  it("BTC/USDT → BTCUSDT",  () => expect(normalizeSymbol("BTC/USDT")).toBe("BTCUSDT"));
  it("btc_usdt → BTCUSDT",  () => expect(normalizeSymbol("btc_usdt")).toBe("BTCUSDT"));
  it("btcusdt → BTCUSDT",   () => expect(normalizeSymbol("btcusdt")).toBe("BTCUSDT"));
  it("ETHUSDT → ETHUSDT",   () => expect(normalizeSymbol("ETHUSDT")).toBe("ETHUSDT"));
  it("ETH/USDT → ETHUSDT",  () => expect(normalizeSymbol("ETH/USDT")).toBe("ETHUSDT"));
  it("ETH_USDT → ETHUSDT",  () => expect(normalizeSymbol("ETH_USDT")).toBe("ETHUSDT"));
});

// ─── toGateApiSymbol ──────────────────────────────────────────────────────────

describe("toGateApiSymbol", () => {
  it("BTCUSDT → BTC_USDT",  () => expect(toGateApiSymbol("BTCUSDT")).toBe("BTC_USDT"));
  it("BTC/USDT → BTC_USDT", () => expect(toGateApiSymbol("BTC/USDT")).toBe("BTC_USDT"));
  it("BTC_USDT → BTC_USDT", () => expect(toGateApiSymbol("BTC_USDT")).toBe("BTC_USDT"));

  // All 5 benchmark symbols (Gate.io format round-trip)
  it("BTC_USDT → BTC_USDT", () => expect(toGateApiSymbol("BTC_USDT")).toBe("BTC_USDT"));
  it("ETH_USDT → ETH_USDT", () => expect(toGateApiSymbol("ETH_USDT")).toBe("ETH_USDT"));
  it("SOL_USDT → SOL_USDT", () => expect(toGateApiSymbol("SOL_USDT")).toBe("SOL_USDT"));
  it("BNB_USDT → BNB_USDT", () => expect(toGateApiSymbol("BNB_USDT")).toBe("BNB_USDT"));
  it("XRP_USDT → XRP_USDT", () => expect(toGateApiSymbol("XRP_USDT")).toBe("XRP_USDT"));
});

// ─── toDisplaySymbol ──────────────────────────────────────────────────────────

describe("toDisplaySymbol", () => {
  it("BTCUSDT → BTC/USDT",  () => expect(toDisplaySymbol("BTCUSDT")).toBe("BTC/USDT"));
  it("BTC_USDT → BTC/USDT", () => expect(toDisplaySymbol("BTC_USDT")).toBe("BTC/USDT"));
  it("BTC/USDT → BTC/USDT", () => expect(toDisplaySymbol("BTC/USDT")).toBe("BTC/USDT"));
  it("ETH_USDT → ETH/USDT", () => expect(toDisplaySymbol("ETH_USDT")).toBe("ETH/USDT"));
  it("SOL_USDT → SOL/USDT", () => expect(toDisplaySymbol("SOL_USDT")).toBe("SOL/USDT"));
});

// ─── InvalidSymbolError ───────────────────────────────────────────────────────

describe("InvalidSymbolError — rejects invalid inputs", () => {
  const invalid = [
    "BTC_/USDT",   // double separator
    "BTC-",        // dash + trailing
    "BTC__USDT",   // double underscore
    "USDT_BTC",    // inverted pair
    "",            // empty
    "BTC",         // no quote
    "_BTCUSDT",    // leading separator
    "BTCUSDT_",    // trailing separator
  ];

  for (const sym of invalid) {
    it(`throws for "${sym}"`, () => {
      expect(() => normalizeSymbol(sym)).toThrow(InvalidSymbolError);
    });
  }
});
