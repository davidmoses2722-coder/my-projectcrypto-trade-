/**
 * terminal/types.ts
 * ─────────────────────────────────────────────────────────────────────────
 * UI-ONLY BUILD PHASE — these are the data contracts the presentational
 * components below expect. Nothing in this folder calls a real API or
 * touches lib/bot.ts, the execution queue, or any engine. Every component
 * receives its data as props with these shapes; a later backend-wiring
 * pass swaps MOCK_* data (see mockData.ts) for real fetches/hooks without
 * touching component internals.
 */

export type MarketMode = "spot" | "futures";
export type Quote = "USDT" | "USDC";
export type OrderSide = "buy" | "sell";
export type PositionSide = "long" | "short";
export type MarginMode = "isolated" | "cross";
export type OrderKind = "market" | "limit" | "trigger" | "conditional";
export type TimeInForce = "GTC" | "IOC" | "FOK" | "POST_ONLY";

export interface MarketRow {
  symbol: string;        // "BTCUSDT"
  base: string;          // "BTC"
  quote: Quote;
  mode: MarketMode;
  category: string;      // "Hot", "New", "DeFi", "Layer1"...
  price: number;
  changePct24h: number;
  volume24hUsd: number;
  favorite: boolean;
}

export interface TickerSnapshot {
  symbol: string;
  displaySymbol: string;
  mode: MarketMode;
  price: number;
  changePct24h: number;
  high24h: number;
  low24h: number;
  volume24hBase: number;
  fundingRatePct?: number;      // futures only
  nextFundingSeconds?: number;  // futures only
  connection: "live" | "connecting" | "offline";
}

export interface Candle {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

export interface OrderBookLevel {
  price: number;
  amount: number;
}

export interface OrderBookSnapshot {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}

export interface RecentTrade {
  id: string;
  price: number;
  amount: number;
  side: OrderSide;
  time: number;
}

export interface RiskEstimate {
  marginUsd: number;
  liquidationPrice: number | null;
  feeUsd: number;
  estPnlUsd: number;
  estPnlPct: number;
}

export interface OpenPositionRow {
  id: string;
  symbol: string;
  mode: MarketMode;
  side: PositionSide;
  size: number;
  entryPrice: number;
  markPrice: number;
  liquidationPrice: number | null;
  marginMode: MarginMode;
  leverage: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPct: number;
}

export interface OpenOrderRow {
  id: string;
  symbol: string;
  mode: MarketMode;
  side: OrderSide;
  kind: OrderKind;
  price: number | null;
  quantity: number;
  filledPct: number;
  status: "open" | "partially_filled";
  createdAt: number;
}

export interface HistoryOrderRow extends Omit<OpenOrderRow, "status"> {
  status: "filled" | "cancelled" | "rejected";
}

export interface TradeHistoryRow {
  id: string;
  symbol: string;
  side: PositionSide;
  entryPrice: number;
  exitPrice: number;
  pnlUsd: number;
  pnlPct: number;
  closedAt: number;
  reason: string;
}

export interface AssetRow {
  asset: string;
  total: number;
  available: number;
  inOrder: number;
  usdValue: number;
}

/**
 * TerminalDataSource — the single seam a backend-wiring pass needs to fill.
 * Replace MOCK_DATA_SOURCE (mockData.ts) with an object of this shape backed
 * by real hooks/fetches. No component below imports mockData.ts directly
 * except the top-level composition file, so swapping this one object is
 * the entire wiring job.
 */
export interface TerminalDataSource {
  markets: MarketRow[];
  ticker: TickerSnapshot;
  candles: Candle[];
  orderBook: OrderBookSnapshot;
  recentTrades: RecentTrade[];
  positions: OpenPositionRow[];
  openOrders: OpenOrderRow[];
  orderHistory: HistoryOrderRow[];
  tradeHistory: TradeHistoryRow[];
  spotAssets: AssetRow[];
  futuresAssets: AssetRow[];
  availableBalanceUsd: number;
}
