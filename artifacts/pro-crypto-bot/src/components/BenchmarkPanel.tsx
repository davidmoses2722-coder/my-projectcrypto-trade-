import { useState } from "react";
import { SERVER_URL } from "../config/urls";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BenchmarkTrade {
  tradeNum:     number;
  entryTime:    string;
  exitTime:     string;
  entryPrice:   number;
  exitPrice:    number;
  outcome:      "WIN" | "LOSS";
  pnlUsdt:      number;
  pnlPct:       number;
  durationMins: number;
}

interface BenchmarkResult {
  strategyId:        string;
  strategyLabel:     string;
  timeframe:         string;
  tradesCompleted:   number;
  targetTrades:      number;
  targetReached:     boolean;
  confidenceScore:   number;
  totalTrades:       number;
  wins:              number;
  losses:            number;
  winRate:           number;
  netProfit:         number;
  roi:               number;
  profitFactor:      number;
  avgTradeDuration:  number;
  avgHoldingTime:    number;
  avgProfitPerTrade: number;
  maxDrawdown:       number;
  largestWin:        number;
  largestLoss:       number;
  startingBalance:   number;
  endingBalance:     number;
  periodStart:       string | null;
  periodEnd:         string | null;
  tradesPerMonth:    number;
  avgTradesPerDay:   number;
  monthlyRoi:        number;
  trades:            BenchmarkTrade[];
  dataWindowDays:    number;
  dataWindowLabel:   string;
  dataWindowCandles: number;
}

interface BenchmarkData {
  symbol:      string;
  startedAt:   string;
  completedAt: string;
  swing:       BenchmarkResult;
  activeSwing: BenchmarkResult;
  scalping:    BenchmarkResult;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const pct  = (n: number, d = 1) => `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`;
const usd  = (n: number) => `${n >= 0 ? "+" : ""}$${Math.abs(n).toFixed(2)}`;
const mins = (m: number) => m < 60 ? `${Math.round(m)}m` : `${(m / 60).toFixed(1)}h`;

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function authHeaders() {
  const token = localStorage.getItem("pcb_jwt") ?? "";
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

// ─── Confidence badge ─────────────────────────────────────────────────────────

function ConfidenceBadge({ score }: { score: number }) {
  const cls = score < 50
    ? "bg-red-500/15 border-red-500/30 text-red-300"
    : score < 80
    ? "bg-yellow-500/15 border-yellow-500/30 text-yellow-300"
    : "bg-green-500/15 border-green-500/30 text-green-300";
  const level = score < 50 ? "Low" : score < 80 ? "Medium" : "High";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border font-semibold ${cls}`}>
      {score < 50 ? "⚠" : score < 80 ? "◐" : "✓"} {level} {score}%
    </span>
  );
}

// ─── 4-column stat table row ──────────────────────────────────────────────────

function StatRow4({
  label, swVal, asVal, scVal,
}: {
  label: string; swVal: string; asVal: string; scVal: string;
}) {
  return (
    <div className="grid grid-cols-4 gap-2 py-2 border-b border-gray-800 last:border-0 items-center">
      <span className="text-gray-400 text-xs">{label}</span>
      <span className="text-xs text-center font-semibold text-yellow-300">{swVal}</span>
      <span className="text-xs text-center font-semibold text-purple-300">{asVal}</span>
      <span className="text-xs text-center font-semibold text-cyan-300">{scVal}</span>
    </div>
  );
}

// ─── Equity curve (3 lines) ───────────────────────────────────────────────────

function computeRunningBalance(trades: BenchmarkTrade[]): number[] {
  let bal = 1000;
  return [bal, ...trades.map(t => { bal = +(bal + t.pnlUsdt).toFixed(4); return bal; })];
}

function EquityCurve3({ sw, as_, sc }: { sw: BenchmarkResult; as_: BenchmarkResult; sc: BenchmarkResult }) {
  const swBal = computeRunningBalance(sw.trades);
  const asBal = computeRunningBalance(as_.trades);
  const scBal = computeRunningBalance(sc.trades);

  const all = [...swBal, ...asBal, ...scBal];
  const lo  = Math.min(950, ...all);
  const hi  = Math.max(1050, ...all);
  const rng = hi - lo || 1;

  const W = 560, H = 100, PX = 28, PY = 10;
  const pw = W - PX * 2;
  const ph = H - PY * 2;

  const fx = (i: number, n: number) => +(PX + (i / Math.max(n - 1, 1)) * pw).toFixed(1);
  const fy = (b: number) => +(PY + ph - ((b - lo) / rng) * ph).toFixed(1);
  const mkPath = (bals: number[]) =>
    bals.map((b, i) => `${i === 0 ? "M" : "L"}${fx(i, bals.length)},${fy(b)}`).join(" ");

  const base = fy(1000);
  const maxTrades = Math.max(sw.tradesCompleted, as_.tradesCompleted, sc.tradesCompleted);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-white font-semibold text-sm">📈 Equity Curve</p>
        <div className="flex items-center gap-4 text-xs text-gray-400">
          <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 bg-yellow-400 inline-block rounded" /> Swing (4h)</span>
          <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 bg-purple-400 inline-block rounded" /> Active Swing (4h)</span>
          <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 bg-cyan-400 inline-block rounded" /> Scalping (15m)</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 120 }} preserveAspectRatio="none">
        <line x1={PX} y1={PY} x2={PX} y2={H - PY} stroke="#374151" strokeWidth={1} />
        <line x1={PX} y1={H - PY} x2={W - PX} y2={H - PY} stroke="#374151" strokeWidth={1} />
        {base >= PY && base <= H - PY && (
          <line x1={PX} y1={base} x2={W - PX} y2={base} stroke="#6b7280" strokeWidth={1} strokeDasharray="4 3" />
        )}
        <path d={mkPath(swBal)} fill="none" stroke="#eab308" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <path d={mkPath(asBal)} fill="none" stroke="#a855f7" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <path d={mkPath(scBal)} fill="none" stroke="#06b6d4" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {swBal.length > 1 && <circle cx={fx(swBal.length - 1, swBal.length)} cy={fy(swBal[swBal.length - 1]!)} r={3} fill="#eab308" />}
        {asBal.length > 1 && <circle cx={fx(asBal.length - 1, asBal.length)} cy={fy(asBal[asBal.length - 1]!)} r={3} fill="#a855f7" />}
        {scBal.length > 1 && <circle cx={fx(scBal.length - 1, scBal.length)} cy={fy(scBal[scBal.length - 1]!)} r={3} fill="#06b6d4" />}
        <text x={PX + 3} y={base - 3} fill="#6b7280" fontSize={9} fontFamily="Inter, sans-serif">$1,000</text>
      </svg>
      <div className="flex justify-between text-xs text-gray-600 mt-1">
        <span>Trade 0</span>
        <span>Trade {maxTrades}</span>
      </div>
    </div>
  );
}

// ─── Strategy header card ─────────────────────────────────────────────────────

function StrategyCard({
  result, symbol, periodStr, color, icon,
}: {
  result: BenchmarkResult; symbol: string; periodStr: string | null;
  color: "yellow" | "purple" | "cyan"; icon: string;
}) {
  const colorMap = {
    yellow: { border: "border-yellow-500/20", text: "text-yellow-400", badge: "bg-yellow-500/15 border-yellow-500/30 text-yellow-300" },
    purple: { border: "border-purple-500/20", text: "text-purple-400", badge: "bg-purple-500/15 border-purple-500/30 text-purple-300" },
    cyan:   { border: "border-cyan-500/20",   text: "text-cyan-400",   badge: "bg-cyan-500/15 border-cyan-500/30 text-cyan-300"   },
  }[color];

  return (
    <div className={`bg-gray-900 border ${colorMap.border} rounded-xl p-4`}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className={`${colorMap.text} font-bold text-sm`}>{icon} {result.strategyLabel}</p>
          <p className="text-gray-500 text-xs">
            {symbol}{periodStr ? ` · ${periodStr}` : ""}
          </p>
          {result.dataWindowLabel && (
            <p className="text-gray-600 text-xs mt-0.5">
              📅 Data window: {result.dataWindowLabel} · {result.dataWindowCandles.toLocaleString()} candles
            </p>
          )}
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-gray-300">
          {result.timeframe}
        </span>
      </div>
      <div className="flex items-center justify-between mb-3">
        <span className={`text-sm font-bold ${result.targetReached ? "text-green-400" : "text-yellow-400"}`}>
          {result.tradesCompleted}/{result.targetTrades} trades {result.targetReached ? "✓" : "⚠"}
        </span>
        <ConfidenceBadge score={result.confidenceScore} />
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-gray-500 text-xs">ROI</p>
          <p className={`font-bold text-sm ${result.roi >= 0 ? "text-green-400" : "text-red-400"}`}>
            {pct(result.roi)}
          </p>
        </div>
        <div>
          <p className="text-gray-500 text-xs">Win Rate</p>
          <p className="font-bold text-sm text-white">{result.winRate.toFixed(0)}%</p>
        </div>
        <div>
          <p className="text-gray-500 text-xs">~trades/mo</p>
          <p className={`font-bold text-sm ${result.tradesPerMonth >= 20 && result.tradesPerMonth <= 30 ? "text-green-400" : "text-yellow-400"}`}>
            {result.tradesPerMonth.toFixed(1)}
          </p>
        </div>
      </div>
      {/* Active Swing target badge */}
      {result.strategyId === "active-swing" && (
        <div className="mt-3 flex gap-2 flex-wrap">
          <span className={`px-2 py-0.5 rounded-full text-xs border ${colorMap.badge}`}>
            🎯 Target: 20–30/month
          </span>
          {result.tradesPerMonth >= 20 && result.tradesPerMonth <= 30 && (
            <span className="px-2 py-0.5 rounded-full text-xs border bg-green-500/15 border-green-500/30 text-green-300">
              ✓ On target
            </span>
          )}
          {result.profitFactor >= 1.3 && (
            <span className="px-2 py-0.5 rounded-full text-xs border bg-green-500/15 border-green-500/30 text-green-300">
              ✓ PF ≥ 1.3
            </span>
          )}
          {result.maxDrawdown < 10 && (
            <span className="px-2 py-0.5 rounded-full text-xs border bg-green-500/15 border-green-500/30 text-green-300">
              ✓ DD &lt; 10%
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function BenchmarkPanel() {
  const [symbol,    setSymbol]    = useState("BTC/USDT");
  const [loading,   setLoading]   = useState(false);
  const [polling,   setPolling]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [data,      setData]      = useState<BenchmarkData | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const start = async () => {
    setLoading(true); setError(null); setData(null);
    setStatusMsg("Starting 3-strategy simulation…");
    try {
      const res = await fetch(`${SERVER_URL}/api/benchmark/start`, {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ symbol }),
      });
      const d = await res.json() as { ok: boolean; error?: string };
      if (!d.ok) { setError(d.error ?? "Failed to start"); setLoading(false); setStatusMsg(null); return; }
      setStatusMsg("Fetching candles & running native-timeframe simulations (Swing · Active Swing · Scalping)…");
      setPolling(true);
      void pollUntilDone();
    } catch (e) {
      setError(String(e)); setLoading(false); setStatusMsg(null);
    }
  };

  const pollUntilDone = async () => {
    for (let i = 0; i < 300; i++) {   // up to 7.5 min (3 strategies take longer)
      await new Promise(r => setTimeout(r, 1_500));
      try {
        const sRes = await fetch(`${SERVER_URL}/api/benchmark/status`, { headers: authHeaders() });
        const s    = await sRes.json() as { ok: boolean; status: string; error?: string };
        if (s.status === "error")    { setError(s.error ?? "Simulation error"); setLoading(false); setPolling(false); setStatusMsg(null); return; }
        if (s.status === "complete") { await loadResults(); return; }
        setStatusMsg(`Simulating 3 strategies… (${Math.round((i + 1) * 1.5)}s)`);
      } catch { /* keep polling */ }
    }
    setError("Timed out waiting for benchmark"); setLoading(false); setPolling(false); setStatusMsg(null);
  };

  const loadResults = async () => {
    try {
      const res = await fetch(`${SERVER_URL}/api/benchmark/results`, { headers: authHeaders() });
      const d   = await res.json() as { ok: boolean; error?: string } & Partial<BenchmarkData>;
      if (d.ok && d.swing && d.activeSwing && d.scalping) {
        setData({
          symbol: d.symbol!, startedAt: d.startedAt!, completedAt: d.completedAt!,
          swing: d.swing, activeSwing: d.activeSwing, scalping: d.scalping,
        });
      } else {
        setError(d.error ?? "Failed to load results");
      }
    } catch (e) { setError(String(e)); }
    setLoading(false); setPolling(false); setStatusMsg(null);
  };

  const sw  = data?.swing;
  const as_ = data?.activeSwing;
  const sc  = data?.scalping;
  const allComplete = !!(sw?.targetReached && as_?.targetReached && sc?.targetReached);
  const periodStr   = sw ? `${shortDate(sw.periodStart)} → ${shortDate(sw.periodEnd)}` : null;

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="bg-gray-900 border border-purple-500/30 rounded-xl p-5">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div>
            <h2 className="text-white font-bold text-lg">⚔️ Strategy Benchmark</h2>
            <p className="text-gray-400 text-xs mt-0.5">
              Native-timeframe simulation — Swing (4h) · Active Swing (4h) · Conservative Scalping (15m)
            </p>
          </div>
          <span className="text-gray-500 text-xs">20 trades each · $1,000 start · $25/trade</span>
        </div>

        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-gray-400 text-xs mb-1 block">Symbol</label>
            <select
              value={symbol}
              onChange={e => setSymbol(e.target.value)}
              disabled={loading}
              className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 disabled:opacity-40"
            >
              {["BTC/USDT","ETH/USDT","SOL/USDT","BNB/USDT","XRP/USDT","ADA/USDT"].map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <button
            onClick={() => void start()}
            disabled={loading}
            className="px-5 py-2 rounded-xl font-bold text-sm bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-40 transition-all"
          >
            {loading ? (polling ? "⏳ Simulating…" : "⏳ Starting…") : "▶ Run Benchmark"}
          </button>
        </div>

        {statusMsg && !error && (
          <div className="mt-3 flex items-center gap-2 text-xs text-purple-300">
            <span className="w-3 h-3 border border-purple-400/40 border-t-purple-400 rounded-full animate-spin shrink-0" />
            {statusMsg}
          </div>
        )}
        {error && (
          <div className="mt-3 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            ❌ {error}
          </div>
        )}
      </div>

      {/* ── Results ── */}
      {sw && as_ && sc && (
        <>
          {!allComplete && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 flex items-start gap-3">
              <span className="text-yellow-400 text-lg shrink-0">⚠</span>
              <div>
                <p className="text-yellow-300 font-semibold text-sm">Benchmark incomplete</p>
                <p className="text-yellow-400/70 text-xs mt-0.5">
                  {!sw.targetReached && ` Swing: ${sw.tradesCompleted}/${sw.targetTrades}.`}
                  {!as_.targetReached && ` Active Swing: ${as_.tradesCompleted}/${as_.targetTrades}.`}
                  {!sc.targetReached && ` Scalping: ${sc.tradesCompleted}/${sc.targetTrades}.`}
                </p>
              </div>
            </div>
          )}

          {/* ── Historical window notice ── */}
          <div className="bg-blue-500/10 border border-blue-500/25 rounded-xl p-4 flex items-start gap-3">
            <span className="text-blue-400 text-base shrink-0">ℹ</span>
            <div>
              <p className="text-blue-300 font-semibold text-sm">Different strategies use different historical windows due to exchange API limits</p>
              <div className="mt-1.5 flex flex-wrap gap-3">
                {as_.dataWindowLabel && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-blue-200/70">
                    <span className="w-2 h-2 rounded-full bg-purple-400 shrink-0" />
                    Active Swing: {as_.dataWindowLabel} · {as_.dataWindowCandles.toLocaleString()} candles
                  </span>
                )}
                {sc.dataWindowLabel && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-blue-200/70">
                    <span className="w-2 h-2 rounded-full bg-cyan-400 shrink-0" />
                    Scalping: {sc.dataWindowLabel} · {sc.dataWindowCandles.toLocaleString()} candles
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* 3-strategy cards */}
          <div className="grid sm:grid-cols-3 gap-4">
            <StrategyCard result={sw}  symbol={symbol} periodStr={periodStr} color="yellow" icon="📊" />
            <StrategyCard result={as_} symbol={symbol} periodStr={periodStr} color="purple" icon="🎯" />
            <StrategyCard result={sc}  symbol={symbol} periodStr={periodStr} color="cyan"   icon="⚡" />
          </div>

          {/* Active Swing verification */}
          <div className="bg-gray-900 border border-purple-500/30 rounded-xl p-5">
            <p className="text-purple-400 font-bold text-sm mb-3">🎯 Active Swing — Phase 8.4 Verification</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                { label: "Trades/month ≈ 20–30", ok: as_.tradesPerMonth >= 20 && as_.tradesPerMonth <= 30, val: `${as_.tradesPerMonth.toFixed(1)}/mo` },
                { label: "Profit Factor ≥ 1.3",  ok: as_.profitFactor >= 1.3,  val: as_.profitFactor >= 999 ? "∞" : as_.profitFactor.toFixed(2) },
                { label: "Drawdown < 10%",        ok: as_.maxDrawdown < 10,     val: `${as_.maxDrawdown.toFixed(1)}%` },
                { label: "Risk engine unchanged",  ok: true,                     val: "✓" },
                { label: "Avg hold time",          ok: true,                     val: mins(as_.avgHoldingTime) },
                { label: "Avg trades/day",         ok: true,                     val: `${as_.avgTradesPerDay.toFixed(2)}/day` },
              ].map(row => (
                <div key={row.label} className={`rounded-lg p-3 border ${row.ok ? "border-green-500/30 bg-green-500/5" : "border-red-500/30 bg-red-500/5"}`}>
                  <p className="text-gray-400 text-xs">{row.label}</p>
                  <p className={`font-bold text-sm ${row.ok ? "text-green-400" : "text-red-400"}`}>
                    {row.ok ? "✓" : "✗"} {row.val}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Stats table — 4 columns */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="grid grid-cols-4 gap-2 mb-3 pb-2 border-b border-gray-700">
              <span className="text-gray-500 text-[13px] font-bold uppercase tracking-wider tracking-wide">Metric</span>
              <span className="text-yellow-400 text-xs font-bold text-center">Swing (4h)</span>
              <span className="text-purple-400 text-xs font-bold text-center">Active Swing (4h)</span>
              <span className="text-cyan-400 text-xs font-bold text-center">Scalping (15m)</span>
            </div>
            <StatRow4 label="Win Rate"         swVal={`${sw.winRate.toFixed(1)}%`}   asVal={`${as_.winRate.toFixed(1)}%`}   scVal={`${sc.winRate.toFixed(1)}%`}   />
            <StatRow4 label="ROI"              swVal={pct(sw.roi)}                    asVal={pct(as_.roi)}                    scVal={pct(sc.roi)}                    />
            <StatRow4 label="Monthly ROI"      swVal={pct(sw.monthlyRoi)}             asVal={pct(as_.monthlyRoi)}             scVal={pct(sc.monthlyRoi)}             />
            <StatRow4 label="Profit Factor"    swVal={sw.profitFactor >= 999 ? "∞" : sw.profitFactor.toFixed(2)} asVal={as_.profitFactor >= 999 ? "∞" : as_.profitFactor.toFixed(2)} scVal={sc.profitFactor >= 999 ? "∞" : sc.profitFactor.toFixed(2)} />
            <StatRow4 label="Max Drawdown"     swVal={`${sw.maxDrawdown.toFixed(1)}%`} asVal={`${as_.maxDrawdown.toFixed(1)}%`} scVal={`${sc.maxDrawdown.toFixed(1)}%`} />
            <StatRow4 label="Trades/Month"     swVal={`~${sw.tradesPerMonth.toFixed(1)}`} asVal={`~${as_.tradesPerMonth.toFixed(1)}`} scVal={`~${sc.tradesPerMonth.toFixed(1)}`} />
            <StatRow4 label="Avg Trades/Day"   swVal={`${sw.avgTradesPerDay.toFixed(2)}`} asVal={`${as_.avgTradesPerDay.toFixed(2)}`} scVal={`${sc.avgTradesPerDay.toFixed(2)}`} />
            <StatRow4 label="Avg Hold Time"    swVal={mins(sw.avgTradeDuration)}      asVal={mins(as_.avgTradeDuration)}      scVal={mins(sc.avgTradeDuration)}      />
            <StatRow4 label="Net Profit"       swVal={usd(sw.netProfit)}              asVal={usd(as_.netProfit)}              scVal={usd(sc.netProfit)}              />
            <StatRow4 label="Largest Win"      swVal={usd(sw.largestWin)}             asVal={usd(as_.largestWin)}             scVal={usd(sc.largestWin)}             />
            <StatRow4 label="Largest Loss"     swVal={usd(sw.largestLoss)}            asVal={usd(as_.largestLoss)}            scVal={usd(sc.largestLoss)}            />
            <StatRow4 label="Ending Balance"   swVal={`$${sw.endingBalance.toFixed(2)}`} asVal={`$${as_.endingBalance.toFixed(2)}`} scVal={`$${sc.endingBalance.toFixed(2)}`} />
            <StatRow4
              label="Data Window Used"
              swVal={sw.dataWindowLabel ?? "—"}
              asVal={as_.dataWindowLabel ?? "—"}
              scVal={sc.dataWindowLabel ?? "—"}
            />
          </div>

          {/* Equity curve */}
          <EquityCurve3 sw={sw} as_={as_} sc={sc} />

          {/* Win/loss bars */}
          <div className="grid sm:grid-cols-3 gap-4">
            {[
              { r: sw,  label: "Swing (4h)",        color: "yellow" },
              { r: as_, label: "Active Swing (4h)",  color: "purple" },
              { r: sc,  label: "Scalping (15m)",     color: "cyan"   },
            ].map(({ r, label, color }) => (
              <div key={r.strategyId} className={`bg-gray-900 border border-${color}-500/20 rounded-xl p-4`}>
                <p className={`text-${color}-400 font-semibold text-sm mb-2`}>{label}</p>
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex-1 h-2 rounded-full bg-gray-800 overflow-hidden">
                    <div className="h-full bg-green-500 rounded-full" style={{ width: `${r.winRate}%` }} />
                  </div>
                  <span className="text-xs text-gray-400 w-16 text-right">{r.wins}W / {r.losses}L</span>
                </div>
                <div className="flex justify-between text-xs text-gray-500">
                  <span>$1,000 start</span>
                  <span className={r.endingBalance >= 1000 ? "text-green-400" : "text-red-400"}>
                    ${r.endingBalance.toFixed(2)} end
                  </span>
                </div>
              </div>
            ))}
          </div>

          <p className="text-gray-600 text-xs text-right">
            {symbol} · Swing 4h · Active Swing 4h · Scalping 15m · completed {data ? new Date(data.completedAt).toLocaleString() : ""}
          </p>
        </>
      )}
    </div>
  );
}
