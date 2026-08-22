/**
 * terminal/useLiveTerminalData.ts
 * ─────────────────────────────────────────────────────────────────────────
 * PHASE 2 — WIRING PASS.
 * Fills the TerminalDataSource contract (types.ts) from endpoints that
 * already exist and already work in ManualTradingCenter.tsx today:
 *   /api/status              (balance, portfolio positions, run mode)
 *   /api/market/tickers      (market list)
 *   /api/market/candles      (chart)
 *   /api/market/orderbook    (order book — NOTE: tuple format [priceStr, sizeStr])
 *   /api/market/trades       (recent trades)
 *   /api/orders              (open orders)
 *   /api/orders/history      (order history)
 *   /api/trade-journal       (trade history)
 *   /api/exchanges/balance   (per-asset spot balances)
 *   /api/futures/*           (futures capability/positions/orders — Phase 3 work)
 *
 * Every section fails independently and falls back to an empty list —
 * never fabricated data. Nothing here calls lib/bot.ts, the execution
 * queue, or any engine directly; it only reads the same REST endpoints
 * the existing, already-shipped spot terminal reads.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { SERVER_URL } from "../../config/urls";
import type {
  TerminalDataSource, MarketRow, TickerSnapshot, Candle, OrderBookSnapshot,
  RecentTrade, OpenPositionRow, OpenOrderRow, HistoryOrderRow, TradeHistoryRow,
  AssetRow, MarketMode, Timeframe,
} from "./types";

const authHeaders = (): Record<string, string> => {
  const token = localStorage.getItem("pcb_jwt");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const EMPTY: TerminalDataSource = {
  markets: [], ticker: {
    symbol: "BTCUSDT", displaySymbol: "BTCUSDT", mode: "futures", price: 0, changePct24h: 0,
    high24h: 0, low24h: 0, volume24hBase: 0, connection: "connecting",
  },
  candles: [], orderBook: { bids: [], asks: [] }, recentTrades: [],
  positions: [], openOrders: [], orderHistory: [], tradeHistory: [],
  spotAssets: [], futuresAssets: [], availableBalanceUsd: 0,
};

function toApiSymbol(displaySymbol: string): string {
  // "BTCUSDT" -> "BTC_USDT" (Gate.io pair format used by /api/market/*)
  if (displaySymbol.includes("_")) return displaySymbol;
  const quotes = ["USDT", "USDC", "USD"];
  for (const q of quotes) {
    if (displaySymbol.endsWith(q)) return `${displaySymbol.slice(0, -q.length)}_${q}`;
  }
  return displaySymbol;
}

interface GateTickerApi { currency_pair: string; last: string; change_percentage: string; quote_volume: string }

export function useLiveTerminalData(mode: MarketMode, displaySymbol: string, timeframe: Timeframe) {
  const [data, setData] = useState<TerminalDataSource>(EMPTY);
  const [connected, setConnected] = useState(false);
  const [partialErrors, setPartialErrors] = useState<string[]>([]);
  const apiSymbol = toApiSymbol(displaySymbol);
  const errRef = useRef<string[]>([]);

  const note = (label: string, ok: boolean) => {
    errRef.current = ok ? errRef.current.filter(e => e !== label) : [...new Set([...errRef.current, label])];
  };

  const fetchMarkets = useCallback(async () => {
    try {
      const r = await fetch(`${SERVER_URL}/api/market/tickers`);
      const raw = await r.json() as GateTickerApi[] | { error?: string };
      if (!Array.isArray(raw)) { note("markets", false); return; }
      const rows: MarketRow[] = raw
        .map(t => {
          const [base, quote] = t.currency_pair.split("_");
          return {
            symbol: t.currency_pair.replace("_", ""), base: base ?? "", quote: (quote as "USDT" | "USDC") ?? "USDT",
            mode, category: "All", price: Number(t.last) || 0, changePct24h: Number(t.change_percentage) || 0,
            volume24hUsd: Number(t.quote_volume) || 0, favorite: false,
          };
        })
        .filter(r => r.base && r.quote && r.price > 0);
       setData(prev => ({ ...prev, markets: rows }));
      note("markets", true);
    } catch { note("markets", false); }
    finally { setPartialErrors([...errRef.current]); }
  }, [mode]);

  const fetchCandles = useCallback(async () => {
    try {
      const r = await fetch(`${SERVER_URL}/api/market/candles?symbol=${apiSymbol}&interval=${timeframe}&limit=200`);
      const d = await r.json() as { ok?: boolean; candles?: Candle[] };
      if (d.ok && d.candles?.length) {
        const valid = d.candles
          .filter(c => Number.isFinite(c.time) && Number.isFinite(c.open) && Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close))
          .sort((a, b) => a.time - b.time);
        setData(prev => ({ ...prev, candles: valid }));
        note("candles", true);
      } else note("candles", false);
    } catch { note("candles", false); }
    finally { setPartialErrors([...errRef.current]); }
  }, [apiSymbol, timeframe]);

  const fetchOrderBook = useCallback(async () => {
    try {
      const r = await fetch(`${SERVER_URL}/api/market/orderbook?symbol=${apiSymbol}&limit=12`);
      const d = await r.json() as { ok?: boolean; asks?: [string, string][]; bids?: [string, string][] };
      if (d.ok) {
        const toLevels = (rows: [string, string][] | undefined) =>
          (rows ?? []).map(([p, a]) => ({ price: Number(p) || 0, amount: Number(a) || 0 }));
        const book: OrderBookSnapshot = { asks: toLevels(d.asks), bids: toLevels(d.bids) };
        setData(prev => ({ ...prev, orderBook: book }));
        note("orderbook", true);
      } else note("orderbook", false);
    } catch { note("orderbook", false); }
    finally { setPartialErrors([...errRef.current]); }
  }, [apiSymbol]);

  const fetchTrades = useCallback(async () => {
    try {
      const r = await fetch(`${SERVER_URL}/api/market/trades?symbol=${apiSymbol}&limit=30`);
      const d = await r.json() as { ok?: boolean; trades?: { id: string; time: number; side: string; price: number; qty: number }[] };
      if (d.ok && d.trades) {
        const trades: RecentTrade[] = d.trades.map(t => ({
          id: t.id, price: t.price, amount: t.qty, side: t.side === "SELL" ? "sell" : "buy", time: t.time,
        }));
        setData(prev => ({ ...prev, recentTrades: trades }));
        note("trades", true);
      } else note("trades", false);
    } catch { note("trades", false); }
    finally { setPartialErrors([...errRef.current]); }
  }, [apiSymbol]);

  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch(`${SERVER_URL}/api/status`, { headers: authHeaders() as HeadersInit });
      const d = await r.json() as {
        lastPrice?: number; balanceUSDT?: number; hasApiKey?: boolean; testMode?: boolean; mode?: string;
        portfolio?: { positions?: { id: string; symbol: string; entryPrice: number; qty: number; lastPrice: number; unrealizedPnl: number; unrealizedPnlPct: number }[] };
      };
      const positions: OpenPositionRow[] = (d.portfolio?.positions ?? []).map(p => ({
        id: p.id, symbol: p.symbol, mode: "spot", side: "long", size: p.qty,
        entryPrice: p.entryPrice, markPrice: p.lastPrice, liquidationPrice: null,
        marginMode: "isolated", leverage: 1, unrealizedPnlUsd: p.unrealizedPnl, unrealizedPnlPct: p.unrealizedPnlPct,
      }));
      setData(prev => ({
        ...prev,
        positions: mode === "spot" ? positions : prev.positions.filter(p => p.mode === "futures"),
        availableBalanceUsd: mode === "spot" ? (d.balanceUSDT ?? 0) : prev.availableBalanceUsd,
        ticker: {
          ...prev.ticker,
          price: d.lastPrice ?? prev.ticker.price,
          connection: "live",
        },
      }));
      setConnected(true);
      note("status", true);
    } catch { note("status", false); setConnected(false); }
    finally { setPartialErrors([...errRef.current]); }
  }, [mode]);

  const fetchOpenOrders = useCallback(async () => {
    try {
      const r = await fetch(`${SERVER_URL}/api/orders`, { headers: authHeaders() as HeadersInit });
      const d = await r.json() as { ok?: boolean; orders?: { orderId: string; symbol: string; side: string; orderType: string; limitPrice: string | null; quantity: string; filledQuantity: string; status: string; createdAt: string }[] };
      if (d.ok && d.orders) {
        const rows: OpenOrderRow[] = d.orders.map(o => ({
          id: o.orderId, symbol: o.symbol, mode: "spot",
          side: o.side === "SELL" ? "sell" : "buy",
          kind: o.orderType === "LIMIT" ? "limit" : "market",
          price: o.limitPrice ? Number(o.limitPrice) : null,
          quantity: Number(o.quantity) || 0,
          filledPct: Number(o.quantity) > 0 ? Math.round((Number(o.filledQuantity) / Number(o.quantity)) * 100) : 0,
          status: "open", createdAt: new Date(o.createdAt).getTime(),
        }));
        setData(prev => ({ ...prev, openOrders: mode === "spot" ? rows : prev.openOrders.filter(o => o.mode === "futures") }));
        note("openOrders", true);
      } else note("openOrders", false);
    } catch { note("openOrders", false); }
    finally { setPartialErrors([...errRef.current]); }
  }, [mode]);

  const fetchOrderHistory = useCallback(async () => {
    try {
      const r = await fetch(`${SERVER_URL}/api/orders/history?limit=100`, { headers: authHeaders() as HeadersInit });
      const d = await r.json() as { ok?: boolean; orders?: { orderId: string; symbol: string; side: string; orderType: string; limitPrice: string | null; quantity: string; status: string; createdAt: string }[] };
      if (d.ok && d.orders) {
        const rows: HistoryOrderRow[] = d.orders.map(o => ({
          id: o.orderId, symbol: o.symbol, mode: "spot",
          side: o.side === "SELL" ? "sell" : "buy",
          kind: o.orderType === "LIMIT" ? "limit" : "market",
          price: o.limitPrice ? Number(o.limitPrice) : null,
          quantity: Number(o.quantity) || 0, filledPct: 100,
          status: o.status === "cancelled" ? "cancelled" : o.status === "rejected" ? "rejected" : "filled",
          createdAt: new Date(o.createdAt).getTime(),
        }));
        setData(prev => ({ ...prev, orderHistory: rows }));
        note("orderHistory", true);
      } else note("orderHistory", false);
    } catch { note("orderHistory", false); }
    finally { setPartialErrors([...errRef.current]); }
  }, []);

  const fetchTradeHistory = useCallback(async () => {
    try {
      const r = await fetch(`${SERVER_URL}/api/trade-journal?limit=50`, { headers: authHeaders() as HeadersInit });
      const d = await r.json() as { ok?: boolean; data?: { id?: string; symbol?: string; side?: string; entryPrice?: number; entry?: number; exitPrice?: number; exit?: number; pnlUsd?: number; pnlPct?: number; exitReason?: string; reason?: string; closedAt?: string | number }[] };
      if (d.ok && d.data) {
        const rows: TradeHistoryRow[] = d.data.map((t, i) => ({
          id: t.id ?? String(i), symbol: t.symbol ?? "—", side: "long",
          entryPrice: t.entryPrice ?? t.entry ?? 0, exitPrice: t.exitPrice ?? t.exit ?? 0,
          pnlUsd: t.pnlUsd ?? 0, pnlPct: t.pnlPct ?? 0,
          closedAt: typeof t.closedAt === "number" ? t.closedAt : t.closedAt ? new Date(t.closedAt).getTime() : Date.now(),
          reason: t.exitReason ?? t.reason ?? "—",
        }));
        setData(prev => ({ ...prev, tradeHistory: rows }));
        note("tradeHistory", true);
      } else note("tradeHistory", false);
    } catch { note("tradeHistory", false); }
    finally { setPartialErrors([...errRef.current]); }
  }, []);

  const fetchSpotAssets = useCallback(async () => {
    try {
      const r = await fetch(`${SERVER_URL}/api/exchanges/balance?exchange=gateio`, { headers: authHeaders() as HeadersInit });
      const d = await r.json() as { ok?: boolean; data?: { totalUsd?: number; balances?: Record<string, number> } };
      if (d.ok && d.data?.balances) {
        const rows: AssetRow[] = Object.entries(d.data.balances)
          .filter(([, total]) => total > 0)
          .map(([asset, total]) => ({ asset, total, available: total, inOrder: 0, usdValue: asset === "USDT" ? total : 0 }));
        setData(prev => ({ ...prev, spotAssets: rows }));
        note("spotAssets", true);
      } else note("spotAssets", false); // e.g. no keys connected — honest empty, not fabricated
    } catch { note("spotAssets", false); }
    finally { setPartialErrors([...errRef.current]); }
  }, []);

  // Futures (Phase 3 endpoints — capability-gated, matches FuturesTerminal.tsx behavior)
  const fetchFutures = useCallback(async () => {
    if (mode !== "futures") return;
    try {
      const [posR, ordR] = await Promise.all([
        fetch(`${SERVER_URL}/api/futures/positions`, { headers: authHeaders() as HeadersInit }),
        fetch(`${SERVER_URL}/api/futures/orders`, { headers: authHeaders() as HeadersInit }),
      ]);
      const posD = await posR.json() as { ok?: boolean; positions?: { symbol: string; side: "long" | "short"; contracts: number; entryPrice: number; markPrice: number; liquidationPrice: number | null; leverage: number; marginMode: "isolated" | "cross"; unrealizedPnl: number }[] };
      const ordD = await ordR.json() as { ok?: boolean; orders?: { orderId: string; symbol: string; side: string; orderType: string; limitPrice: string | null; quantity: string; status: string; positionSide: string | null; createdAt: string }[] };

      const positions: OpenPositionRow[] = (posD.positions ?? []).map(p => ({
        id: `${p.symbol}-${p.side}`, symbol: p.symbol, mode: "futures", side: p.side, size: p.contracts,
        entryPrice: p.entryPrice, markPrice: p.markPrice, liquidationPrice: p.liquidationPrice,
        marginMode: p.marginMode, leverage: p.leverage,
        unrealizedPnlUsd: p.unrealizedPnl, unrealizedPnlPct: p.entryPrice > 0 ? (p.unrealizedPnl / (p.entryPrice * p.contracts)) * 100 : 0,
      }));
      const orders: OpenOrderRow[] = (ordD.orders ?? [])
        .filter(o => o.status === "open" || o.status === "pending")
        .map(o => ({
          id: o.orderId, symbol: o.symbol, mode: "futures",
          side: o.side === "SELL" || o.side === "sell" ? "sell" : "buy",
          kind: o.orderType === "LIMIT" ? "limit" : "market",
          price: o.limitPrice ? Number(o.limitPrice) : null,
          quantity: Number(o.quantity) || 0, filledPct: 0, status: "open",
          createdAt: new Date(o.createdAt).getTime(),
        }));

      setData(prev => ({
        ...prev,
        positions: [...prev.positions.filter(p => p.mode === "spot"), ...positions],
        openOrders: [...prev.openOrders.filter(o => o.mode === "spot"), ...orders],
      }));
      note("futures", true);
    } catch { note("futures", false); }
    finally { setPartialErrors([...errRef.current]); }
  }, [mode]);

  useEffect(() => { void fetchMarkets(); const id = setInterval(fetchMarkets, 15_000); return () => clearInterval(id); }, [fetchMarkets]);
  useEffect(() => { void fetchCandles(); }, [fetchCandles]);
  useEffect(() => { void fetchOrderBook(); const id = setInterval(fetchOrderBook, 5000); return () => clearInterval(id); }, [fetchOrderBook]);
  useEffect(() => { void fetchTrades(); const id = setInterval(fetchTrades, 8000); return () => clearInterval(id); }, [fetchTrades]);
  useEffect(() => { void fetchStatus(); const id = setInterval(fetchStatus, 5000); return () => clearInterval(id); }, [fetchStatus]);
  useEffect(() => { void fetchOpenOrders(); const id = setInterval(fetchOpenOrders, 10_000); return () => clearInterval(id); }, [fetchOpenOrders]);
  useEffect(() => { void fetchOrderHistory(); }, [fetchOrderHistory]);
  useEffect(() => { void fetchTradeHistory(); }, [fetchTradeHistory]);
  useEffect(() => { void fetchSpotAssets(); }, [fetchSpotAssets]);
  useEffect(() => { void fetchFutures(); const id = setInterval(fetchFutures, 8000); return () => clearInterval(id); }, [fetchFutures]);

  return { data, connected, partialErrors };
}
