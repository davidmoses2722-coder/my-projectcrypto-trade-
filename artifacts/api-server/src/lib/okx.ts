import crypto from "node:crypto";
import { logger } from "./logger";

/**
 * OKX V5 REST client with HMAC-SHA256 signing.
 *
 * Auth header scheme:
 *   prehash    = ISO_TIMESTAMP + METHOD + REQUEST_PATH + BODY
 *   signature  = base64( HMAC_SHA256(secret, prehash) )
 *   headers    = OK-ACCESS-KEY, OK-ACCESS-SIGN, OK-ACCESS-TIMESTAMP,
 *                OK-ACCESS-PASSPHRASE, x-simulated-trading (1 = paper)
 */

const OKX_BASE = "https://www.okx.com";

export interface OkxCreds {
  apiKey: string;
  apiSecret: string;
  passphrase: string;
  /** true → use OKX demo trading (no real funds) */
  paper?: boolean;
}

/** Convert "BTCUSDT" (Binance style) → "BTC-USDT" (OKX). */
export function toOkxInst(symbol: string): string {
  if (symbol.includes("-")) return symbol.toUpperCase();
  const s = symbol.toUpperCase();
  if (s.endsWith("USDT")) return `${s.slice(0, -4)}-USDT`;
  if (s.endsWith("USDC")) return `${s.slice(0, -4)}-USDC`;
  if (s.endsWith("BTC"))  return `${s.slice(0, -3)}-BTC`;
  return s;
}

function sign(secret: string, prehash: string): string {
  return crypto.createHmac("sha256", secret).update(prehash).digest("base64");
}

function isoTs(): string {
  // OKX requires ISO 8601 with milliseconds, ending in Z
  return new Date().toISOString();
}

interface OkxResponse<T = unknown> {
  code: string;
  msg: string;
  data: T;
}

async function okxRequest<T = unknown>(
  method: "GET" | "POST",
  path: string,
  creds: OkxCreds | null,
  body?: object,
  query?: Record<string, string>,
): Promise<OkxResponse<T>> {
  let qs = "";
  if (query && Object.keys(query).length > 0) {
    qs = "?" + new URLSearchParams(query).toString();
  }
  const requestPath = path + qs;
  const bodyStr = body ? JSON.stringify(body) : "";
  const url = OKX_BASE + requestPath;

  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (creds) {
    const ts = isoTs();
    const prehash = ts + method + requestPath + bodyStr;
    headers["OK-ACCESS-KEY"]        = creds.apiKey;
    headers["OK-ACCESS-SIGN"]       = sign(creds.apiSecret, prehash);
    headers["OK-ACCESS-TIMESTAMP"]  = ts;
    headers["OK-ACCESS-PASSPHRASE"] = creds.passphrase;
    if (creds.paper) headers["x-simulated-trading"] = "1";
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: method === "POST" && bodyStr ? bodyStr : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json: OkxResponse<T>;
    try { json = JSON.parse(text) as OkxResponse<T>; }
    catch { throw new Error(`OKX ${res.status} non-JSON: ${text.slice(0, 200)}`); }
    if (!res.ok && !json.code) {
      throw new Error(`OKX HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Public ──────────────────────────────────────────────────────────────────

export async function ping(): Promise<{ ok: boolean; latencyMs: number; serverTime?: number }> {
  const t0 = Date.now();
  const j = await okxRequest<Array<{ ts: string }>>("GET", "/api/v5/public/time", null);
  const latencyMs = Date.now() - t0;
  const serverTime = j.data?.[0]?.ts ? Number(j.data[0].ts) : undefined;
  return { ok: j.code === "0", latencyMs, serverTime };
}

export async function getTicker(symbol: string): Promise<{
  symbol: string; price: number; bid: number; ask: number; open24h: number; vol24h: number;
}> {
  const instId = toOkxInst(symbol);
  const j = await okxRequest<Array<{
    instId: string; last: string; bidPx: string; askPx: string; open24h: string; vol24h: string;
  }>>("GET", "/api/v5/market/ticker", null, undefined, { instId });
  if (j.code !== "0" || !j.data?.[0]) {
    throw new Error(`OKX ticker failed: ${j.msg || "no data"}`);
  }
  const t = j.data[0];
  return {
    symbol,
    price:   Number(t.last),
    bid:     Number(t.bidPx),
    ask:     Number(t.askPx),
    open24h: Number(t.open24h),
    vol24h:  Number(t.vol24h),
  };
}

// ─── Authenticated ───────────────────────────────────────────────────────────

export async function testAuth(creds: OkxCreds): Promise<{ ok: boolean; error?: string }> {
  try {
    const j = await okxRequest<unknown[]>("GET", "/api/v5/account/balance", creds);
    if (j.code === "0") return { ok: true };
    return { ok: false, error: `OKX ${j.code}: ${j.msg}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface BalanceItem { ccy: string; available: number; total: number; }

export async function getBalance(creds: OkxCreds): Promise<{
  totalEqUsd: number; details: BalanceItem[];
}> {
  const j = await okxRequest<Array<{
    totalEq: string;
    details: Array<{ ccy: string; availBal: string; cashBal: string; eq: string }>;
  }>>("GET", "/api/v5/account/balance", creds);
  if (j.code !== "0") throw new Error(`OKX balance ${j.code}: ${j.msg}`);
  const acct = j.data?.[0];
  const details: BalanceItem[] = (acct?.details ?? []).map((d) => ({
    ccy: d.ccy,
    available: Number(d.availBal),
    total: Number(d.cashBal || d.eq),
  }));
  return { totalEqUsd: Number(acct?.totalEq ?? 0), details };
}

export interface PlaceOrderArgs {
  symbol: string;
  side: "buy" | "sell";
  /** "market" or "limit" */
  ordType?: "market" | "limit";
  /** Quote-currency size for market BUY; base-currency size for market SELL or limit. */
  size: string | number;
  price?: string | number;
  clOrdId?: string;
}

export async function placeOrder(creds: OkxCreds, args: PlaceOrderArgs): Promise<{
  ok: boolean; orderId?: string; clOrdId?: string; error?: string;
}> {
  const instId = toOkxInst(args.symbol);
  const ordType = args.ordType ?? "market";
  // OKX market BUY uses tgtCcy=quote_ccy so `sz` is quote (USDT) amount.
  const body: Record<string, string> = {
    instId,
    tdMode: "cash",          // spot
    side: args.side,
    ordType,
    sz: String(args.size),
  };
  if (ordType === "market" && args.side === "buy") body.tgtCcy = "quote_ccy";
  if (ordType === "limit" && args.price !== undefined) body.px = String(args.price);
  body.clOrdId = args.clOrdId ?? `pcb${Date.now()}${Math.floor(Math.random() * 1e4)}`;

  const j = await okxRequest<Array<{ ordId: string; clOrdId: string; sCode: string; sMsg: string }>>(
    "POST", "/api/v5/trade/order", creds, body,
  );
  const r = j.data?.[0];
  if (j.code === "0" && r?.sCode === "0") {
    return { ok: true, orderId: r.ordId, clOrdId: r.clOrdId };
  }
  const errMsg = r?.sMsg || j.msg || `code ${j.code}`;
  logger.warn({ args, errMsg, raw: j }, "OKX placeOrder failed");
  return { ok: false, error: errMsg };
}

// ─── Public market data ───────────────────────────────────────────────────────

export interface OkxCandle {
  time:    number;   // Unix ms
  open:    number;
  high:    number;
  low:     number;
  close:   number;
  volume:  number;   // base currency volume
  volUsdt: number;   // quote currency (USDT) volume
}

/**
 * Fetch OHLCV candles from OKX public endpoint (no auth required).
 * OKX returns data newest-first; this function reverses to oldest-first.
 *
 * @param symbol  e.g. "BTCUSDT" or "BTC-USDT"
 * @param bar     candle timeframe: "1m","3m","5m","15m","30m","1H","4H","1D"
 * @param limit   number of candles (max 300)
 */
export async function getCandles(
  symbol: string,
  bar     = "1H",
  limit   = 200,
): Promise<OkxCandle[]> {
  const instId = toOkxInst(symbol);
  // OKX response: array of [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]
  const j = await okxRequest<string[][]>(
    "GET", "/api/v5/market/candles", null,
    undefined, { instId, bar, limit: String(Math.min(limit, 300)) },
  );
  if (j.code !== "0" || !Array.isArray(j.data)) {
    throw new Error(`OKX getCandles failed: ${j.msg || "no data"}`);
  }
  // Reverse so array is oldest → newest
  const candles: OkxCandle[] = j.data
    .reverse()
    .map((row) => ({
      time:    Number(row[0]),
      open:    Number(row[1]),
      high:    Number(row[2]),
      low:     Number(row[3]),
      close:   Number(row[4]),
      volume:  Number(row[5]),
      volUsdt: Number(row[7] ?? row[6]),
    }));
  return candles;
}

export async function cancelOrder(
  creds: OkxCreds, symbol: string, orderId: string,
): Promise<{ ok: boolean; error?: string }> {
  const j = await okxRequest<Array<{ sCode: string; sMsg: string }>>(
    "POST", "/api/v5/trade/cancel-order", creds,
    { instId: toOkxInst(symbol), ordId: orderId },
  );
  const r = j.data?.[0];
  if (j.code === "0" && r?.sCode === "0") return { ok: true };
  return { ok: false, error: r?.sMsg || j.msg };
}
