/**
 * terminal/mockData.ts
 * ─────────────────────────────────────────────────────────────────────────
 * MOCK DATA — UI BUILD PHASE ONLY.
 * Every value here is hand-authored, not fetched. This file is the ONLY
 * place in the terminal/ folder that "fakes" anything, and it does so
 * openly: every export is prefixed MOCK_ so a backend-wiring pass can grep
 * for "MOCK_" and know exactly what to replace. No component computes or
 * invents numbers on its own — they all just render whatever DataSource
 * they're given.
 */
import type {
  MarketRow, TickerSnapshot, Candle, OrderBookSnapshot, RecentTrade,
  OpenPositionRow, OpenOrderRow, HistoryOrderRow, TradeHistoryRow,
  AssetRow, TerminalDataSource,
} from "./types";

export const MOCK_MARKETS: MarketRow[] = [
  { symbol: "BTCUSDT", base: "BTC", quote: "USDT", mode: "futures", category: "Hot", price: 63291.2, changePct24h: 0.92, volume24hUsd: 2_140_000_000, favorite: true },
  { symbol: "ETHUSDT", base: "ETH", quote: "USDT", mode: "futures", category: "Hot", price: 3412.6, changePct24h: -1.14, volume24hUsd: 980_000_000, favorite: true },
  { symbol: "SOLUSDT", base: "SOL", quote: "USDT", mode: "futures", category: "Hot", price: 178.34, changePct24h: 3.41, volume24hUsd: 512_000_000, favorite: false },
  { symbol: "BNBUSDT", base: "BNB", quote: "USDT", mode: "futures", category: "Layer1", price: 612.11, changePct24h: 0.21, volume24hUsd: 210_000_000, favorite: false },
  { symbol: "XRPUSDT", base: "XRP", quote: "USDT", mode: "spot", category: "Payments", price: 0.612, changePct24h: -0.44, volume24hUsd: 340_000_000, favorite: false },
  { symbol: "ADAUSDT", base: "ADA", quote: "USDT", mode: "spot", category: "Layer1", price: 0.441, changePct24h: 1.02, volume24hUsd: 120_000_000, favorite: false },
  { symbol: "AVAXUSDT", base: "AVAX", quote: "USDT", mode: "futures", category: "Layer1", price: 27.9, changePct24h: 2.15, volume24hUsd: 165_000_000, favorite: false },
  { symbol: "DOGEUSDT", base: "DOGE", quote: "USDT", mode: "spot", category: "Meme", price: 0.1122, changePct24h: 4.87, volume24hUsd: 300_000_000, favorite: true },
  { symbol: "BTCUSDC", base: "BTC", quote: "USDC", mode: "spot", category: "Hot", price: 63288.4, changePct24h: 0.90, volume24hUsd: 88_000_000, favorite: false },
  { symbol: "ETHUSDC", base: "ETH", quote: "USDC", mode: "spot", category: "Hot", price: 3411.9, changePct24h: -1.16, volume24hUsd: 41_000_000, favorite: false },
];

export const MOCK_TICKER: TickerSnapshot = {
  symbol: "BTCUSDT",
  displaySymbol: "BTCUSDT",
  mode: "futures",
  price: 63291.2,
  changePct24h: 0.92,
  high24h: 63980.0,
  low24h: 62104.5,
  volume24hBase: 18420.7,
  fundingRatePct: 0.01,
  nextFundingSeconds: 20839,
  connection: "live",
};

function genCandles(count: number, start: number): Candle[] {
  const out: Candle[] = [];
  let price = start;
  let t = Math.floor(Date.now() / 1000) - count * 900;
  for (let i = 0; i < count; i++) {
    const drift = (Math.sin(i / 7) + (i % 5 === 0 ? 0.6 : 0)) * (start * 0.0015);
    const open = price;
    const close = open + drift;
    const high = Math.max(open, close) + Math.abs(drift) * 0.6;
    const low = Math.min(open, close) - Math.abs(drift) * 0.6;
    out.push({ time: t, open, high, low, close, volume: 20 + Math.abs(drift) * 4 });
    price = close;
    t += 900;
  }
  return out;
}
export const MOCK_CANDLES: Candle[] = genCandles(140, 62800);

function genBook(mid: number): OrderBookSnapshot {
  const asks = Array.from({ length: 12 }, (_, i) => ({
    price: Math.round((mid + (i + 1) * mid * 0.00006) * 100) / 100,
    amount: Number((Math.random() * 3 + 0.01).toFixed(4)),
  })).reverse();
  const bids = Array.from({ length: 12 }, (_, i) => ({
    price: Math.round((mid - (i + 1) * mid * 0.00006) * 100) / 100,
    amount: Number((Math.random() * 3 + 0.01).toFixed(4)),
  }));
  return { asks, bids };
}
export const MOCK_ORDER_BOOK: OrderBookSnapshot = genBook(MOCK_TICKER.price);

export const MOCK_RECENT_TRADES: RecentTrade[] = Array.from({ length: 24 }, (_, i) => ({
  id: `t${i}`,
  price: Math.round((MOCK_TICKER.price + (Math.random() - 0.5) * 20) * 100) / 100,
  amount: Number((Math.random() * 0.5 + 0.001).toFixed(5)),
  side: Math.random() > 0.5 ? "buy" : "sell",
  time: Date.now() - i * 4000,
}));

export const MOCK_POSITIONS: OpenPositionRow[] = [
  {
    id: "p1", symbol: "BTCUSDT", mode: "futures", side: "long", size: 0.042,
    entryPrice: 62480, markPrice: 63291.2, liquidationPrice: 57120.5,
    marginMode: "isolated", leverage: 20, unrealizedPnlUsd: 34.08, unrealizedPnlPct: 13.1,
  },
];

export const MOCK_OPEN_ORDERS: OpenOrderRow[] = [
  {
    id: "o1", symbol: "ETHUSDT", mode: "futures", side: "buy", kind: "limit",
    price: 3350, quantity: 0.8, filledPct: 0, status: "open", createdAt: Date.now() - 900_000,
  },
];

export const MOCK_ORDER_HISTORY: HistoryOrderRow[] = [
  { id: "h1", symbol: "BTCUSDT", mode: "spot", side: "buy", kind: "market", price: 62480, quantity: 0.042, filledPct: 100, status: "filled", createdAt: Date.now() - 3_600_000 },
  { id: "h2", symbol: "SOLUSDT", mode: "futures", side: "sell", kind: "limit", price: 182.4, quantity: 12, filledPct: 0, status: "cancelled", createdAt: Date.now() - 7_200_000 },
];

export const MOCK_TRADE_HISTORY: TradeHistoryRow[] = [
  { id: "th1", symbol: "SOLUSDT", side: "long", entryPrice: 165.2, exitPrice: 178.34, pnlUsd: 78.4, pnlPct: 7.9, closedAt: Date.now() - 86_400_000, reason: "take_profit" },
  { id: "th2", symbol: "ETHUSDT", side: "short", entryPrice: 3480, exitPrice: 3412.6, pnlUsd: 41.2, pnlPct: 1.9, closedAt: Date.now() - 172_800_000, reason: "manual_close" },
];

export const MOCK_SPOT_ASSETS: AssetRow[] = [
  { asset: "USDT", total: 4820.11, available: 4210.11, inOrder: 610.0, usdValue: 4820.11 },
  { asset: "BTC", total: 0.021, available: 0.021, inOrder: 0, usdValue: 1329.1 },
];

export const MOCK_FUTURES_ASSETS: AssetRow[] = [
  { asset: "USDT", total: 2100.4, available: 1734.9, inOrder: 365.5, usdValue: 2100.4 },
];

export const MOCK_DATA_SOURCE: TerminalDataSource = {
  markets: MOCK_MARKETS,
  ticker: MOCK_TICKER,
  candles: MOCK_CANDLES,
  orderBook: MOCK_ORDER_BOOK,
  recentTrades: MOCK_RECENT_TRADES,
  positions: MOCK_POSITIONS,
  openOrders: MOCK_OPEN_ORDERS,
  orderHistory: MOCK_ORDER_HISTORY,
  tradeHistory: MOCK_TRADE_HISTORY,
  spotAssets: MOCK_SPOT_ASSETS,
  futuresAssets: MOCK_FUTURES_ASSETS,
  availableBalanceUsd: 4210.11,
};
