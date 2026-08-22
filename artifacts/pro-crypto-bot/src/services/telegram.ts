/**
 * Telegram Bot Notification Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Env vars (set in .env):
 *   VITE_TELEGRAM_TOKEN   = your bot token from @BotFather
 *   VITE_TELEGRAM_CHAT_ID = your chat/group ID
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BUG FIX — The provided code used:
 *
 *   import axios from "axios";
 *   export const alert = (msg) =>
 *     axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
 *       chat_id: CHAT, text: msg,
 *     });
 *
 * Two problems in a Vite/browser build:
 *
 *  1. `axios` requires a CommonJS/Node-compatible bundler config.
 *     In a strict browser ESM build it triggers runtime errors on POST.
 *     → Fixed: replaced with native browser `fetch()` — no dependency needed.
 *
 *  2. `export const alert` shadows the browser's built-in `window.alert`.
 *     TypeScript/ESLint flags this as a collision; some bundlers warn.
 *     → Fixed: the function is named `telegramAlert` internally and exported
 *       as both `alert` (exact original name) and `telegramAlert` (safe alias).
 *       Use `telegramAlert` in all internal code to avoid the global shadow.
 *
 * The public API surface is kept identical:
 *   alert(msg: string) → Promise<{ data: TelegramResponse }>
 * (axios-compatible response envelope so callers need zero changes)
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Config ───────────────────────────────────────────────────────────────────
// Keys are read at call-time so web-UI changes take effect immediately.

import { getRuntimeCredentials, isValidTelegramToken, isValidChatId } from "../hooks/useCredentials";

export const TELEGRAM_TOKEN   = import.meta.env.VITE_TELEGRAM_TOKEN   || "";
export const TELEGRAM_CHAT_ID = import.meta.env.VITE_TELEGRAM_CHAT_ID || "";

/** Static boolean for initial render */
export const hasValidTelegramConfig: boolean =
  !!TELEGRAM_TOKEN &&
  TELEGRAM_TOKEN !== "your_token" &&
  !!TELEGRAM_CHAT_ID &&
  TELEGRAM_CHAT_ID !== "your_chat_id";

/** Dynamic check — reflects runtime/localStorage credentials immediately */
export const checkTelegramConfig = (): boolean => {
  const creds = getRuntimeCredentials();
  return isValidTelegramToken(creds.telegramToken) && isValidChatId(creds.telegramChatId);
};

/** Dynamic base URL — always uses the latest token from the store */
function getBaseUrl(): string {
  return `https://api.telegram.org/bot${getRuntimeCredentials().telegramToken}`;
}
/** Dynamic chat ID */
function getChatId(): string {
  return getRuntimeCredentials().telegramChatId;
}

// ─── Telegram API response shape ──────────────────────────────────────────────

export interface TelegramResponse {
  ok:          boolean;
  result?:     unknown;
  description?: string;
  error_code?:  number;
}

/** axios-compatible response envelope */
export interface TelegramAxiosLike {
  data:   TelegramResponse;
  status: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// ██████████  CORE — alert(msg)  [exact provided API, browser-safe]
// ─────────────────────────────────────────────────────────────────────────────

/**
 * alert(msg)
 * ─────────────────────────────────────────────────────────────────────────────
 * Sends a plain-text message to your Telegram chat.
 *
 * Exact port of:
 *   axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
 *     chat_id: CHAT, text: msg,
 *   });
 *
 * Returns an axios-compatible envelope { data, status } so any caller that
 * does `.then(res => res.data)` works without changes.
 *
 * @param msg  Plain text message (no HTML formatting)
 * @returns    Promise<{ data: TelegramResponse, status: number }>
 */
export async function alert(msg: string): Promise<TelegramAxiosLike> {
  if (!checkTelegramConfig()) {
    return {
      data:   { ok: false, description: "Telegram not configured" },
      status: 0,
    };
  }

  const res = await fetch(`${getBaseUrl()}/sendMessage`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: getChatId(),
      text:    msg,
    }),
  });

  const data = (await res.json()) as TelegramResponse;

  if (!res.ok || !data.ok) {
    console.warn("[Telegram] alert() failed:", data.description ?? res.statusText);
  }

  // Return axios-compatible shape: { data, status }
  return { data, status: res.status };
}

/**
 * telegramAlert — safe alias for `alert()` that avoids shadowing window.alert.
 * Use this in all internal service code.
 */
export const telegramAlert = alert;

// ─── Message queue — prevents Telegram 429 rate-limit errors ─────────────────

interface QueueItem {
  text:      string;
  parseMode: "HTML" | "MarkdownV2" | undefined;
}

const messageQueue: QueueItem[] = [];
let   queueRunning = false;

async function processQueue() {
  if (queueRunning || messageQueue.length === 0) return;
  queueRunning = true;

  while (messageQueue.length > 0) {
    const item = messageQueue.shift()!;
    try {
      await sendRaw(item.text, item.parseMode);
    } catch (e) {
      console.warn("[Telegram] Queue send failed:", e);
    }
    // Telegram allows ~1 msg/second per bot — wait 1.1 s to be safe
    await new Promise((r) => setTimeout(r, 1100));
  }

  queueRunning = false;
}

// ─── Low-level raw sender (supports HTML parse_mode) ─────────────────────────

async function sendRaw(
  text:       string,
  parseMode?: "HTML" | "MarkdownV2"
): Promise<void> {
  if (!checkTelegramConfig()) return;

  const body: Record<string, string> = {
    chat_id: getChatId(),
    text,
  };
  if (parseMode) body.parse_mode = parseMode;

  const res = await fetch(`${getBaseUrl()}/sendMessage`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    console.warn("[Telegram] sendRaw error:", err);
  }
}

// ─── Public queue-based sender (HTML, rate-limited) ──────────────────────────

/**
 * sendTelegramMessage — enqueue an HTML-formatted message.
 * Rate-limited to 1 msg/second automatically.
 */
export function sendTelegramMessage(text: string): void {
  // FIX: use checkTelegramConfig() (runtime) not hasValidTelegramConfig (build-time static)
  // hasValidTelegramConfig is always false when keys are entered via the web UI
  if (!checkTelegramConfig()) return;
  messageQueue.push({ text, parseMode: "HTML" });
  processQueue();
}

// ─────────────────────────────────────────────────────────────────────────────
// Pre-built notification helpers
// ─────────────────────────────────────────────────────────────────────────────

export function notifySignal(params: {
  type:       "BUY" | "SELL" | "HOLD";
  symbol:     string;
  price:      number;
  target:     number;
  stopLoss:   number;
  confidence: number;
  strength:   string;
  reason:     string;
}): void {
  const emoji = params.type === "BUY" ? "🟢" : params.type === "SELL" ? "🔴" : "🟡";
  const arrow = params.type === "BUY" ? "📈" : params.type === "SELL" ? "📉" : "⏸";

  const fmt = (p: number) =>
    p >= 100
      ? `$${p.toLocaleString(undefined, { maximumFractionDigits: 1 })}`
      : `$${p.toFixed(p >= 1 ? 4 : 6)}`;

  const msg = [
    `${emoji} <b>PROCRYPTOBOT SIGNAL</b> ${arrow}`,
    ``,
    `<b>Action:</b>    ${params.type} ${params.symbol}`,
    `<b>Strength:</b>  ${params.strength}`,
    `<b>Confidence:</b> ${params.confidence}%`,
    ``,
    `<b>Entry:</b>     ${fmt(params.price)}`,
    `<b>Target:</b>    ${fmt(params.target)}`,
    `<b>Stop Loss:</b> ${fmt(params.stopLoss)}`,
    ``,
    `📋 <i>${params.reason}</i>`,
    ``,
    `⏰ ${new Date().toLocaleString()}`,
  ].join("\n");

  sendTelegramMessage(msg);
}

export function notifyTradeOpen(params: {
  type:   "BUY" | "SELL";
  symbol: string;
  amount: number;
  price:  number;
  total:  number;
}): void {
  const emoji = params.type === "BUY" ? "✅" : "⚡";
  const fmt   = (p: number) =>
    p >= 100
      ? `$${p.toLocaleString(undefined, { maximumFractionDigits: 1 })}`
      : `$${p.toFixed(4)}`;

  const msg = [
    `${emoji} <b>TRADE OPENED</b>`,
    ``,
    `<b>Pair:</b>   ${params.symbol}/USDT`,
    `<b>Side:</b>   ${params.type}`,
    `<b>Amount:</b> ${params.amount} ${params.symbol}`,
    `<b>Price:</b>  ${fmt(params.price)}`,
    `<b>Total:</b>  $${params.total.toFixed(2)}`,
    ``,
    `⏰ ${new Date().toLocaleString()}`,
  ].join("\n");

  sendTelegramMessage(msg);
}

export function notifyTradeClosed(params: {
  type:       "BUY" | "SELL";
  symbol:     string;
  amount:     number;
  entryPrice: number;
  exitPrice:  number;
  pnl:        number;
  pnlPercent: number;
  reason:     "TP" | "SL" | "MANUAL";
}): void {
  const win   = params.pnl >= 0;
  const emoji =
    params.reason === "TP" ? "🏆" : params.reason === "SL" ? "🛑" : "📤";
  const sign  = win ? "+" : "";

  const fmt = (p: number) =>
    p >= 100
      ? `$${p.toLocaleString(undefined, { maximumFractionDigits: 1 })}`
      : `$${p.toFixed(4)}`;

  const msg = [
    `${emoji} <b>TRADE CLOSED — ${
      params.reason === "TP"
        ? "TAKE PROFIT"
        : params.reason === "SL"
        ? "STOP LOSS"
        : "MANUAL"
    }</b>`,
    ``,
    `<b>Pair:</b>   ${params.symbol}/USDT`,
    `<b>Side:</b>   ${params.type}`,
    `<b>Amount:</b> ${params.amount} ${params.symbol}`,
    `<b>Entry:</b>  ${fmt(params.entryPrice)}`,
    `<b>Exit:</b>   ${fmt(params.exitPrice)}`,
    ``,
    `<b>P&L:</b>    ${sign}$${params.pnl.toFixed(2)} (${sign}${params.pnlPercent.toFixed(2)}%)`,
    ``,
    `⏰ ${new Date().toLocaleString()}`,
  ].join("\n");

  sendTelegramMessage(msg);
}

export function notifyBotStatus(running: boolean, strategy?: string): void {
  const msg = running
    ? [
        `🚀 <b>PROCRYPTOBOT STARTED</b>`,
        ``,
        `<b>Strategy:</b> ${strategy || "swing"}`,
        `<b>Status:</b>   Scanning markets...`,
        `⏰ ${new Date().toLocaleString()}`,
      ].join("\n")
    : [
        `⛔ <b>PROCRYPTOBOT STOPPED</b>`,
        ``,
        `Bot has been deactivated by user.`,
        `⏰ ${new Date().toLocaleString()}`,
      ].join("\n");

  sendTelegramMessage(msg);
}

export function notifyError(message: string): void {
  const msg = [
    `⚠️ <b>PROCRYPTOBOT ERROR</b>`,
    ``,
    message,
    `⏰ ${new Date().toLocaleString()}`,
  ].join("\n");

  sendTelegramMessage(msg);
}

// ─────────────────────────────────────────────────────────────────────────────
// Connection tests
// ─────────────────────────────────────────────────────────────────────────────

/**
 * testTelegramConnection — sends a test message and returns ok/error.
 */
export async function testTelegramConnection(): Promise<{
  ok: boolean;
  botUsername?: string;
  error?: string;
}> {
  // Guard: check config before doing anything (avoids malformed-URL errors)
  if (!checkTelegramConfig()) {
    return {
      ok:    false,
      error: "Telegram not configured. Enter your Bot Token and Chat ID in Settings → API Keys, then click Save.",
    };
  }

  try {
    // Step 1: validate the token via getMe
    const baseUrl = getBaseUrl();
    const meRes   = await fetch(`${baseUrl}/getMe`, { method: "GET" });

    if (!meRes.ok) {
      const err = await meRes.text();
      return { ok: false, error: `getMe failed (${meRes.status}): ${err}` };
    }

    const meData = (await meRes.json()) as { ok: boolean; result?: { username: string; first_name: string } };
    if (!meData.ok) {
      return { ok: false, error: "Invalid bot token — getMe returned ok:false" };
    }
    const botUsername = meData.result?.username;

    // Step 2: send a test message to the configured chat
    const res = await alert(
      `✅ ProCryptoBot — Connection test OK!\nBot: @${botUsername ?? "unknown"}\n⏰ ${new Date().toLocaleString()}`
    );

    return res.data.ok
      ? { ok: true, botUsername }
      : {
          ok:    false,
          error: res.data.description
            ?? `sendMessage failed. Make sure you started a chat with @${botUsername} first.`,
        };
  } catch (e) {
    return { ok: false, error: `Network error: ${String(e)}` };
  }
}

/**
 * getBotInfo — verifies token via getMe, returns bot username.
 */
export async function getBotInfo(): Promise<{
  ok: boolean;
  username?: string;
  error?: string;
}> {
  // FIX: use runtime check so web-UI keys are picked up immediately
  if (!checkTelegramConfig()) {
    return { ok: false, error: "Telegram token/chat ID not configured yet" };
  }
  try {
    const res  = await fetch(`${getBaseUrl()}/getMe`);
    const data = (await res.json()) as {
      ok: boolean;
      result?: { username: string };
    };
    if (data.ok && data.result) {
      return { ok: true, username: data.result.username };
    }
    return { ok: false, error: "Invalid response from Telegram" };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
