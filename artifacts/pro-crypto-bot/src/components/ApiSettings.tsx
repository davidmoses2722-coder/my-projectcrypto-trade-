import { useState, useEffect } from "react";
import {
  BINANCE_API_KEY,
  BINANCE_SECRET_KEY,
  hasValidBinanceKeys,
  checkBinanceKeys,
  pingBinance,
  getBinanceServerTime,
  size,
} from "../services/binance";
import {
  TELEGRAM_TOKEN,
  TELEGRAM_CHAT_ID,
  hasValidTelegramConfig,
  checkTelegramConfig,
  testTelegramConnection,
  getBotInfo,
  telegramAlert,
} from "../services/telegram";

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-sm font-semibold px-2.5 py-1 rounded-full ${
        ok
          ? "bg-green-500/15 text-green-400 border border-green-500/30"
          : "bg-red-500/15 text-red-400 border border-red-500/30"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-green-400 animate-pulse" : "bg-red-400"}`} />
      {label}
    </span>
  );
}

// ─── Section card ─────────────────────────────────────────────────────────────
function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-gray-900 border border-gray-800 rounded-xl p-5 ${className}`}>
      {children}
    </div>
  );
}

// ─── Masked key display ───────────────────────────────────────────────────────
function MaskedKey({ value, placeholder }: { value: string; placeholder: string }) {
  const [show, setShow] = useState(false);
  const isEmpty = !value || value === placeholder;

  const masked = isEmpty
    ? "— not set —"
    : show
    ? value
    : value.slice(0, 6) + "••••••••••••" + value.slice(-4);

  return (
    <div className="flex items-center gap-2">
      <code className={`flex-1 font-mono text-xs px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 ${isEmpty ? "text-gray-600" : "text-cyan-300"}`}>
        {masked}
      </code>
      {!isEmpty && (
        <button
          onClick={() => setShow((s) => !s)}
          className="text-gray-500 hover:text-gray-300 text-xs px-2 py-1 rounded border border-gray-700 hover:border-gray-600 transition-colors"
        >
          {show ? "Hide" : "Show"}
        </button>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export function ApiSettings() {
  // Binance status
  const [binancePing,    setBinancePing]    = useState<boolean | null>(null);
  const [binanceMethod,  setBinanceMethod]  = useState<string | null>(null);
  const [binanceLatency, setBinanceLatency] = useState<number | null>(null);
  const [binanceTime,    setBinanceTime]    = useState<number | null>(null);
  const [binancePingErr, setBinancePingErr] = useState<string | null>(null);
  const [binanceTesting, setBinanceTesting] = useState(false);

  // Telegram status
  const [telegramBot, setTelegramBot]     = useState<string | null>(null);
  const [telegramOk, setTelegramOk]       = useState<boolean | null>(null);
  const [telegramErr, setTelegramErr]     = useState<string | null>(null);
  const [telegramTesting, setTelegramTesting] = useState(false);
  const [telegramSent, setTelegramSent]   = useState(false);

  // Quick alert() test
  const [alertSending, setAlertSending]   = useState(false);
  const [alertResult,  setAlertResult]    = useState<string | null>(null);

  // ── Binance ping ────────────────────────────────────────────────────────
  // BUG FIX: result is PingResult { ok, latencyMs, method, serverTime, error }
  //          NOT a boolean. Always use result.ok — never treat result as truthy.
  async function testBinance() {
    setBinanceTesting(true);
    setBinancePing(null);
    setBinanceMethod(null);
    setBinanceLatency(null);
    setBinancePingErr(null);
    setBinanceTime(null);
    try {
      const result = await pingBinance();        // returns PingResult object
      setBinancePing(result.ok);                 // ← use .ok not the object!
      setBinanceMethod(result.method ?? null);
      if (result.latencyMs !== undefined) setBinanceLatency(result.latencyMs);
      if (result.error)     setBinancePingErr(result.error);
      if (result.serverTime) setBinanceTime(result.serverTime);
      // If serverTime not in ping result, try separate call
      if (result.ok && !result.serverTime) {
        try {
          const time = await getBinanceServerTime();
          setBinanceTime(time);
        } catch { /* optional */ }
      }
    } catch (e) {
      setBinancePing(false);
      setBinancePingErr(String(e));
    } finally {
      setBinanceTesting(false);
    }
  }

  // ── Telegram test ───────────────────────────────────────────────────────
  async function testTelegram() {
    setTelegramTesting(true);
    setTelegramOk(null);
    setTelegramErr(null);
    setTelegramSent(false);
    try {
      const info = await getBotInfo();
      if (info.ok) setTelegramBot(info.username || null);
      const result = await testTelegramConnection();
      setTelegramOk(result.ok);
      if (!result.ok) setTelegramErr(result.error || "Unknown error");
      else {
        setTelegramSent(true);
        if (result.botUsername && !info.ok) setTelegramBot(result.botUsername);
      }
    } catch (e) {
      setTelegramOk(false);
      setTelegramErr(String(e));
    } finally {
      setTelegramTesting(false);
    }
  }

  // ── Quick alert() test ─────────────────────────────────────────────────
  async function runQuickAlert() {
    setAlertSending(true);
    setAlertResult(null);
    try {
      const res = await telegramAlert(
        `🤖 PROCRYPTOBOT — Quick alert() test\nSent via alert(msg) directly\n⏰ ${new Date().toLocaleString()}`
      );
      setAlertResult(
        res.data.ok
          ? `✅ alert() OK — status ${res.status}`
          : `❌ alert() failed — ${res.data.description ?? "unknown error"}`
      );
    } catch (e) {
      setAlertResult(`❌ ${String(e)}`);
    } finally {
      setAlertSending(false);
    }
  }

  // Auto-ping removed — was always failing at mount (WS not connected yet)
  void useEffect; // keep import to avoid potential downstream breakage

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div>
        <h2 className="text-white font-bold text-lg">API Configuration</h2>
        <p className="text-gray-500 text-sm mt-0.5">
          Manage your Binance and Telegram integrations. Set keys in your <code className="text-cyan-400 text-xs bg-gray-800 px-1.5 py-0.5 rounded">.env</code> file.
        </p>
      </div>

      {/* .env instructions */}
      <Card>
        <h3 className="text-white font-semibold text-sm mb-3 flex items-center gap-2">
          <span>📄</span> Environment Variables
        </h3>
        <p className="text-gray-500 text-xs mb-3">
          Create or edit <code className="text-yellow-400">.env</code> in your project root with the following variables:
        </p>
        <pre className="bg-gray-950 border border-gray-700 rounded-lg p-4 text-xs font-mono overflow-x-auto text-green-300 leading-relaxed">
{`VITE_BINANCE_API_KEY=your_key
VITE_BINANCE_SECRET_KEY=your_secret

VITE_TELEGRAM_TOKEN=your_token
VITE_TELEGRAM_CHAT_ID=your_chat_id`}
        </pre>
        <p className="text-gray-600 text-xs mt-3">
          ⚠️ After editing <code className="text-yellow-400">.env</code>, restart the dev server (<code className="text-cyan-400">npm run dev</code>) for changes to take effect.
        </p>
      </Card>

      {/* ── Telegram Code Architecture ────────────────────────────────────────── */}
      <Card>
        <h3 className="text-white font-semibold text-sm mb-1 flex items-center gap-2">
          <span>📲</span> Telegram — Code Architecture & Bug Fix
        </h3>
        <p className="text-gray-500 text-xs mb-4">
          How <code className="text-blue-300">alert(msg)</code> was ported from{" "}
          <code className="text-red-400">axios</code> to browser-native{" "}
          <code className="text-green-400">fetch</code>.
        </p>

        {/* Side-by-side diff */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          {/* Original — broken */}
          <div className="bg-red-950/30 border border-red-500/30 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-red-400 text-xs font-bold">❌ Original (Node-only)</span>
            </div>
            <pre className="text-xs text-red-300/70 leading-relaxed overflow-x-auto whitespace-pre-wrap">{`import axios from "axios";
// ⚠️ axios.post fails in ESM browser
// ⚠️ alert shadows window.alert

const TOKEN = import.meta.env
  .VITE_TELEGRAM_TOKEN;
const CHAT = import.meta.env
  .VITE_TELEGRAM_CHAT_ID;

export const alert = (msg: string) => {
  return axios.post(
    \`https://api.telegram.org/\` +
    \`bot\${TOKEN}/sendMessage\`,
    { chat_id: CHAT, text: msg }
  );
};`}</pre>
          </div>

          {/* Fixed — browser safe */}
          <div className="bg-green-950/30 border border-green-500/30 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-green-400 text-xs font-bold">✅ Fixed (Browser-safe)</span>
            </div>
            <pre className="text-xs text-green-300/70 leading-relaxed overflow-x-auto whitespace-pre-wrap">{`// No import needed — fetch is built-in
// alert exported + telegramAlert alias

export async function alert(
  msg: string
): Promise<{ data, status }> {
  const res = await fetch(
    \`https://api.telegram.org/\` +
    \`bot\${TOKEN}/sendMessage\`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: CHAT, text: msg
      }),
    }
  );
  const data = await res.json();
  return { data, status: res.status };
}`}</pre>
          </div>
        </div>

        {/* Bug summary */}
        <div className="space-y-2 mb-4">
          {[
            {
              bug:   "axios.post() in browser ESM",
              fix:   "Replaced with native fetch() — zero dependencies",
              color: "red",
            },
            {
              bug:   "export const alert — shadows window.alert",
              fix:   "Exported as both alert (original) and telegramAlert (safe alias)",
              color: "orange",
            },
            {
              bug:   "No axios-like response envelope",
              fix:   "Returns { data: TelegramResponse, status: number } — drop-in compatible",
              color: "yellow",
            },
            {
              bug:   "No rate limiting — Telegram bans bots at >1 msg/s",
              fix:   "Added message queue with 1.1 s delay between messages",
              color: "purple",
            },
          ].map((item) => (
            <div
              key={item.bug}
              className="flex gap-3 bg-gray-950 border border-gray-700/50 rounded-lg px-3 py-2"
            >
              <span className="text-red-400 text-xs mt-0.5">✗</span>
              <div className="flex-1 min-w-0">
                <p className="text-red-300/80 text-xs truncate">{item.bug}</p>
                <p className="text-green-300/80 text-xs mt-0.5">→ {item.fix}</p>
              </div>
            </div>
          ))}
        </div>

        {/* alert() quick test */}
        <div className="border-t border-gray-800 pt-4">
          <p className="text-gray-400 text-sm font-semibold mb-2">
            Test <code className="text-blue-300">alert(msg)</code> directly:
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={runQuickAlert}
              disabled={alertSending || (!checkTelegramConfig() && !hasValidTelegramConfig)}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-400 hover:bg-blue-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {alertSending ? "Sending..." : "📨 Run alert(msg)"}
            </button>
            {alertResult && (
              <span
                className={`text-xs ${
                  alertResult.startsWith("✅") ? "text-green-400" : "text-red-400"
                }`}
              >
                {alertResult}
              </span>
            )}
            {!checkTelegramConfig() && !hasValidTelegramConfig && (
              <span className="text-gray-600 text-xs">
                Enter Telegram keys in <strong className="text-cyan-400">Settings → API Keys</strong> to test
              </span>
            )}
          </div>
          {/* Code preview */}
          <pre className="mt-3 bg-gray-950 border border-gray-700/50 rounded-lg p-3 text-xs text-gray-400 overflow-x-auto">{`// Called by runQuickAlert():
const res = await alert("🤖 PROCRYPTOBOT — Quick alert() test");
console.log(res.status);   // e.g. 200
console.log(res.data.ok);  // true`}</pre>
        </div>

        {/* Function call chain */}
        <div className="mt-4 flex items-center gap-2 text-xs text-gray-500 flex-wrap">
          <span className="px-2 py-1 bg-gray-800 rounded font-mono text-gray-300">useBotEngine</span>
          <span>→</span>
          <span className="px-2 py-1 bg-blue-900/40 rounded font-mono text-blue-300">telegramAlert(msg)</span>
          <span>=</span>
          <span className="px-2 py-1 bg-green-900/40 rounded font-mono text-green-300">alert(msg)</span>
          <span>→</span>
          <span className="px-2 py-1 bg-gray-800 rounded font-mono text-gray-300">fetch(Telegram API)</span>
          <span>→</span>
          <span className="px-2 py-1 bg-gray-800 rounded font-mono text-gray-300">{"{ data, status }"}</span>
        </div>
      </Card>

      {/* ── Order & Signing Architecture ──────────────────────────────────────── */}
      <Card>
        <h3 className="text-white font-semibold text-sm mb-1 flex items-center gap-2">
          <span>🔐</span> Order & Signing Architecture
        </h3>
        <p className="text-gray-500 text-xs mb-4">
          How <code className="text-purple-300">order()</code>, <code className="text-purple-300">size()</code>, and{" "}
          <code className="text-purple-300">sign()</code> are integrated in this build.
        </p>

        {/* Function breakdown */}
        <div className="space-y-3 mb-4">
          {/* sign() */}
          <div className="bg-gray-950 border border-gray-700/60 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-yellow-400 font-bold font-mono text-xs">sign(query)</span>
              <span className="text-gray-600 text-xs">→ HMAC-SHA256 hex string</span>
              <span className="ml-auto text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                Browser-safe
              </span>
            </div>
            <pre className="text-xs text-gray-400 leading-relaxed overflow-x-auto">{`// Original: crypto.createHmac("sha256", SECRET).update(q).digest("hex")
// Browser:  window.crypto.subtle.sign("HMAC", cryptoKey, msgData)
//           → identical hex output, no Node.js required`}</pre>
          </div>

          {/* order() */}
          <div className="bg-gray-950 border border-gray-700/60 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-cyan-400 font-bold font-mono text-xs">order(side, qty)</span>
              <span className="text-gray-600 text-xs">→ BinanceOrderResult</span>
              <span className="ml-auto text-xs px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                BTCUSDT Market
              </span>
            </div>
            <pre className="text-xs text-gray-400 leading-relaxed overflow-x-auto">{`const query = \`symbol=BTCUSDT&side=\${side}&type=MARKET
              &quantity=\${qty}&timestamp=\${Date.now()}\`;
const sig   = await sign(query);           // SubtleCrypto HMAC
fetch(\`/api/v3/order?\${query}&signature=\${sig}\`, {
  method: "POST", headers: { "X-MBX-APIKEY": KEY },
});`}</pre>
          </div>

          {/* size() */}
          <div className="bg-gray-950 border border-gray-700/60 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-green-400 font-bold text-xs">size(balance, price)</span>
              <span className="text-gray-600 text-xs">→ BTC qty (6dp)</span>
              <span className="ml-auto text-xs px-2 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20">
                1% Risk Rule
              </span>
            </div>
            <pre className="text-xs text-gray-400 leading-relaxed">{`parseFloat(((balance * 0.01) / price).toFixed(6))`}</pre>
            {/* Live size preview */}
            <div className="mt-2 flex items-center gap-2 bg-gray-900 rounded px-3 py-2">
              <span className="text-gray-500 text-xs">size(10 000, 67 500) =</span>
              <span className="text-green-300 font-bold text-sm ml-auto">
                {size(10000, 67500)} BTC
              </span>
            </div>
          </div>
        </div>

        {/* Flow diagram */}
        <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap">
          <span className="px-2 py-1 bg-gray-800 rounded text-gray-300">useBotEngine</span>
          <span>→</span>
          <span className="px-2 py-1 bg-purple-900/40 rounded text-purple-300">size(balance, price)</span>
          <span>→</span>
          <span className="px-2 py-1 bg-yellow-900/40 rounded text-yellow-300">sign(query)</span>
          <span>→</span>
          <span className="px-2 py-1 bg-cyan-900/40 rounded text-cyan-300">order(side, qty)</span>
          <span>→</span>
          <span className="px-2 py-1 bg-gray-800 rounded text-gray-300">Binance API</span>
        </div>
      </Card>

      {/* ── Binance Section ─────────────────────────────────────────────────── */}
      <Card>
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center text-xl">
              🔑
            </div>
            <div>
              <h3 className="text-white font-semibold">Binance API</h3>
              <p className="text-gray-500 text-xs">Live price data & order execution</p>
            </div>
          </div>
          <StatusBadge ok={hasValidBinanceKeys} label={hasValidBinanceKeys ? "Keys Configured" : "No Keys"} />
        </div>

        <div className="space-y-3 mb-4">
          <div>
            <label className="text-gray-500 text-xs block mb-1.5">API Key</label>
            <MaskedKey value={BINANCE_API_KEY} placeholder="your_key" />
          </div>
          <div>
            <label className="text-gray-500 text-xs block mb-1.5">Secret Key</label>
            <MaskedKey value={BINANCE_SECRET_KEY} placeholder="your_secret" />
          </div>
        </div>

        {/* Connectivity test */}
        <div className="flex items-center gap-3 pt-4 border-t border-gray-800">
          <button
            onClick={testBinance}
            disabled={binanceTesting}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/20 transition-all disabled:opacity-50"
          >
            {binanceTesting ? (
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 border border-yellow-400/30 border-t-yellow-400 rounded-full animate-spin" />
                Testing…
              </span>
            ) : "🔗 Test Binance Connection"}
          </button>

          {binancePing !== null && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-3 flex-wrap">
                <StatusBadge ok={binancePing} label={binancePing ? "Connected" : "Failed"} />
                {binanceMethod && (
                  <span className="text-gray-400 text-xs bg-gray-800 px-2 py-0.5 rounded-full">
                    via {binanceMethod}
                  </span>
                )}
                {binanceLatency !== null && binanceLatency > 0 && (
                  <span className="text-gray-500 text-xs">{binanceLatency}ms</span>
                )}
                {binanceTime && (
                  <span className="text-gray-500 text-xs">
                    Server: {new Date(binanceTime).toLocaleTimeString()}
                  </span>
                )}
              </div>
              {binancePingErr && (
                <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  {binancePingErr}
                </p>
              )}
              {!binancePing && !binancePingErr && (
                <p className="text-orange-400 text-xs bg-orange-500/10 border border-orange-500/20 rounded-lg px-3 py-2">
                  ⚠️ CORS blocked direct REST access. Live prices use WebSocket streams (no CORS). Private order execution requires a local proxy or VPS deployment.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Capabilities */}
        <div className="mt-4 grid grid-cols-2 gap-2">
          {[
            { label: "Live Price Feed",      ok: true,                                   note: "WebSocket — no keys needed" },
            { label: "Order Execution",       ok: checkBinanceKeys() || hasValidBinanceKeys, note: "Requires valid API keys" },
            { label: "Account Balance",       ok: checkBinanceKeys() || hasValidBinanceKeys, note: "Requires valid API keys" },
            { label: "Trade History",         ok: checkBinanceKeys() || hasValidBinanceKeys, note: "Requires valid API keys" },
          ].map((cap) => (
            <div key={cap.label} className="flex items-center gap-2 bg-gray-800/50 rounded-lg px-3 py-2">
              <span className={`text-sm ${cap.ok ? "text-green-400" : "text-gray-600"}`}>
                {cap.ok ? "✓" : "✗"}
              </span>
              <div>
                <p className={`text-sm font-semibold ${cap.ok ? "text-gray-300" : "text-gray-600"}`}>{cap.label}</p>
                <p className="text-gray-600 text-xs">{cap.note}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Setup guide */}
        <div className="mt-4 bg-yellow-500/5 border border-yellow-500/15 rounded-lg p-3">
          <p className="text-yellow-400 text-sm font-semibold mb-1">📋 How to get Binance API keys:</p>
          <ol className="text-gray-500 text-xs space-y-0.5 list-decimal list-inside">
            <li>Log in to <span className="text-cyan-400">binance.com</span></li>
            <li>Go to Profile → API Management</li>
            <li>Create a new API key (enable "Spot & Margin Trading" if you want live orders)</li>
            <li>Copy the API Key and Secret Key into your <code className="text-yellow-400">.env</code> file</li>
          </ol>
        </div>
      </Card>

      {/* ── Telegram Section ─────────────────────────────────────────────────── */}
      <Card>
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-xl">
              📲
            </div>
            <div>
              <h3 className="text-white font-semibold">Telegram Notifications</h3>
              <p className="text-gray-500 text-xs">Real-time alerts for signals & trades</p>
            </div>
          </div>
          <StatusBadge ok={hasValidTelegramConfig} label={hasValidTelegramConfig ? "Configured" : "Not Set"} />
        </div>

        <div className="space-y-3 mb-4">
          <div>
            <label className="text-gray-500 text-xs block mb-1.5">Bot Token</label>
            <MaskedKey value={TELEGRAM_TOKEN} placeholder="your_token" />
            {telegramBot && (
              <p className="text-green-400 text-xs mt-1">✓ Bot: @{telegramBot}</p>
            )}
          </div>
          <div>
            <label className="text-gray-500 text-xs block mb-1.5">Chat ID</label>
            <MaskedKey value={TELEGRAM_CHAT_ID} placeholder="your_chat_id" />
          </div>
        </div>

        {/* Test button */}
        <div className="flex items-center gap-3 pt-4 border-t border-gray-800">
          <button
            onClick={testTelegram}
            disabled={telegramTesting}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-400 hover:bg-blue-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {telegramTesting ? (
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 border border-blue-400/30 border-t-blue-400 rounded-full animate-spin" />
                Sending…
              </span>
            ) : "📨 Send Test Message"}
          </button>

          {telegramOk !== null && (
            <StatusBadge ok={telegramOk} label={telegramOk ? "Message Sent!" : "Failed"} />
          )}
          {telegramSent && (
            <span className="text-green-400 text-xs">Check your Telegram chat ✓</span>
          )}
          {telegramErr && (
            <span className="text-red-400 text-xs truncate max-w-xs">{telegramErr}</span>
          )}
        </div>

        {/* Alert types */}
        <div className="mt-4 grid grid-cols-2 gap-2">
          {[
            { label: "Signal Alerts",    emoji: "🎯", desc: "BUY/SELL/HOLD signals" },
            { label: "Trade Opened",     emoji: "✅", desc: "Auto-trade executions" },
            { label: "Take Profit Hit",  emoji: "🏆", desc: "TP reached notification" },
            { label: "Stop Loss Hit",    emoji: "🛑", desc: "SL triggered notification" },
            { label: "Bot Status",       emoji: "🤖", desc: "Start/stop events" },
            { label: "Error Alerts",     emoji: "⚠️", desc: "API & order errors" },
          ].map((item) => (
            <div key={item.label} className={`flex items-center gap-2 rounded-lg px-3 py-2 ${(checkTelegramConfig() || hasValidTelegramConfig) ? "bg-gray-800/50" : "bg-gray-800/20 opacity-50"}`}>
              <span className="text-sm">{item.emoji}</span>
              <div>
                <p className="text-sm font-semibold text-gray-300">{item.label}</p>
                <p className="text-gray-600 text-xs">{item.desc}</p>
              </div>
              {(checkTelegramConfig() || hasValidTelegramConfig) && (
                <span className="ml-auto text-green-400 text-xs">✓</span>
              )}
            </div>
          ))}
        </div>

        {/* Setup guide */}
        <div className="mt-4 bg-blue-500/5 border border-blue-500/15 rounded-lg p-3">
          <p className="text-blue-400 text-sm font-semibold mb-1">📋 How to set up Telegram bot:</p>
          <ol className="text-gray-500 text-xs space-y-0.5 list-decimal list-inside">
            <li>Open Telegram → search <span className="text-cyan-400">@BotFather</span></li>
            <li>Send <code className="text-green-400">/newbot</code> → follow prompts → copy your TOKEN</li>
            <li>Start a chat with your new bot</li>
            <li>Visit: <code className="text-cyan-400">https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code></li>
            <li>Find <code className="text-green-400">"chat": &#123;"id": 123456&#125;</code> → that's your CHAT_ID</li>
            <li>Add both to your <code className="text-yellow-400">.env</code> file</li>
          </ol>
        </div>
      </Card>

      {/* ── Security notice ───────────────────────────────────────────────────── */}
      <Card className="border-orange-500/20 bg-orange-500/5">
        <div className="flex items-start gap-3">
          <span className="text-2xl">🔒</span>
          <div>
            <h3 className="text-orange-400 font-semibold text-sm mb-1">Security Notice</h3>
            <ul className="text-gray-400 text-xs space-y-1 list-disc list-inside">
              <li>Never share your API keys or commit them to version control</li>
              <li>Add <code className="text-yellow-400">.env</code> to your <code className="text-yellow-400">.gitignore</code> file</li>
              <li>For Binance: restrict API key IP to your server's IP address</li>
              <li>For trading bots: use keys with only "Spot Trading" permission — never withdrawal permissions</li>
              <li>Keys prefixed with <code className="text-cyan-400">VITE_</code> are embedded in the built bundle — do not deploy to public servers with real keys</li>
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
}
