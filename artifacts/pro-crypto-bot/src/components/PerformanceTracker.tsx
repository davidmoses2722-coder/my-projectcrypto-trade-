// ─────────────────────────────────────────────────────────────────────────────
// PerformanceTracker — Auto-logging, trade history, equity curve, stats export
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef } from "react";
import { logger, LogEntry, TradeLog, LogLevel } from "../utils/logger";

const LEVEL_COLOR: Record<LogLevel, string> = {
  DEBUG:  "text-gray-500",
  INFO:   "text-blue-300",
  WARN:   "text-yellow-300",
  ERROR:  "text-red-400",
  TRADE:  "text-green-300",
  SIGNAL: "text-cyan-300",
  RISK:   "text-orange-300",
  SYSTEM: "text-purple-300",
};

const LEVEL_BG: Record<LogLevel, string> = {
  DEBUG:  "bg-gray-700/30",
  INFO:   "bg-blue-500/5",
  WARN:   "bg-yellow-500/8",
  ERROR:  "bg-red-500/8",
  TRADE:  "bg-green-500/8",
  SIGNAL: "bg-cyan-500/8",
  RISK:   "bg-orange-500/8",
  SYSTEM: "bg-purple-500/8",
};

export function PerformanceTracker({ botLog }: { botLog: string[] }) {
  const [tab, setTab] = useState<"log" | "trades" | "stats" | "equity">("log");
  const [logFilter, setLogFilter] = useState<LogLevel | "ALL">("ALL");
  const [logs, setLogs]           = useState<LogEntry[]>([]);
  const [tradeLogs, setTradeLogs] = useState<TradeLog[]>([]);
  const [stats, setStats]         = useState(logger.getStats());
  const [perfData, setPerfData]   = useState<{ equity: number; drawdown: number; riskScore: number }[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Refresh logger data every 3s
  useEffect(() => {
    const tick = () => {
      setLogs(logger.getLogs({ limit: 200, sessionOnly: true }));
      setTradeLogs(logger.getTradeLogs());
      setStats(logger.getStats());
      const snaps = logger.getPerfSnapshots(24);
      setPerfData(snaps.map((s) => ({ equity: s.equity, drawdown: s.drawdown, riskScore: s.riskScore })).reverse());
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => clearInterval(id);
  }, []);

  // Log the in-memory bot log entries into the persistent logger
  useEffect(() => {
    if (botLog.length > 0 && botLog[0]) {
      const latest = botLog[0];
      const level: LogLevel =
        latest.includes("ERROR") || latest.includes("❌") ? "ERROR" :
        latest.includes("⚠️")   || latest.includes("WARN")  ? "WARN" :
        latest.includes("TRADE") || latest.includes("AUTO-TRADE") || latest.includes("✅") ? "TRADE" :
        latest.includes("Signal") || latest.includes("🎯")  ? "SIGNAL" :
        latest.includes("RISK")  || latest.includes("🛑")   ? "RISK" :
        latest.includes("🔗")    || latest.includes("SYSTEM") ? "SYSTEM" : "INFO";
      logger.log(level, "BotEngine", latest);
    }
  }, [botLog]);

  useEffect(() => {
    if (autoScroll && logEndRef.current && tab === "log") {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll, tab]);

  const filteredLogs = logFilter === "ALL" ? logs : logs.filter((l) => l.level === logFilter);

  const equityValues = perfData.map((p) => p.equity);
  const drawdownValues = perfData.map((p) => p.drawdown);
  const equityMin = Math.min(...(equityValues.length ? equityValues : [0]));
  const equityMax = Math.max(...(equityValues.length ? equityValues : [10000]));

  return (
    <div className="space-y-4">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-white font-black text-lg">📈 Performance Tracker</h2>
          <p className="text-gray-500 text-xs mt-0.5">Auto-logging · Persistent · Exportable · Session: {logger.getSessionId()}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => logger.exportLogsCSV()}
            className="text-xs bg-blue-500/15 border border-blue-500/30 text-blue-300 hover:bg-blue-500/25 px-3 py-1.5 rounded-lg transition-colors"
          >
            📥 Export Logs
          </button>
          <button
            onClick={() => logger.exportTradesCSV()}
            className="text-xs bg-green-500/15 border border-green-500/30 text-green-300 hover:bg-green-500/25 px-3 py-1.5 rounded-lg transition-colors"
          >
            📥 Export Trades
          </button>
          <button
            onClick={() => { logger.clearLogs(); setLogs([]); }}
            className="text-xs bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 px-3 py-1.5 rounded-lg transition-colors"
          >
            🗑️ Clear
          </button>
        </div>
      </div>

      {/* ── Quick stats ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {[
          { label: "Total Trades",   value: stats.totalTrades,                    color: "text-white" },
          { label: "Win Rate",       value: `${stats.winRate}%`,                  color: stats.winRate >= 50 ? "text-green-400" : "text-red-400" },
          { label: "Profit Factor",  value: stats.profitFactor,                   color: stats.profitFactor >= 1.5 ? "text-green-400" : "text-yellow-400" },
          { label: "Total P&L",      value: `$${stats.totalPnL.toFixed(2)}`,      color: stats.totalPnL >= 0 ? "text-green-400" : "text-red-400" },
          { label: "Max Drawdown",   value: `$${stats.maxDrawdown.toFixed(2)}`,   color: "text-red-400" },
          { label: "Best Trade",     value: `$${stats.bestTrade.toFixed(2)}`,     color: "text-green-400" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-gray-900 border border-gray-800 rounded-xl p-3">
            <p className="text-xs text-gray-500 mb-1">{label}</p>
            <p className={`text-sm font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────── */}
      <div className="flex gap-1 bg-gray-900 rounded-xl p-1">
        {([["log", "📋 Live Log"], ["trades", "💹 Trades"], ["stats", "📊 Stats"], ["equity", "📈 Equity Curve"]] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 text-sm font-semibold py-2 rounded-lg transition-all ${
              tab === id ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30" : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Log Tab ─────────────────────────────────────────────────────── */}
      {tab === "log" && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 p-3 border-b border-gray-800 flex-wrap">
            <span className="text-xs text-gray-400">Filter:</span>
            {(["ALL", "INFO", "TRADE", "SIGNAL", "WARN", "ERROR", "RISK", "SYSTEM"] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLogFilter(l)}
                className={`text-xs font-bold px-2 py-0.5 rounded-full border transition-colors ${
                  logFilter === l
                    ? "bg-cyan-500/25 border-cyan-500/40 text-cyan-300"
                    : "border-gray-700 text-gray-500 hover:text-gray-300"
                }`}
              >
                {l}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
                <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} className="w-3 h-3" />
                Auto-scroll
              </label>
              <span className="text-xs text-gray-600">{filteredLogs.length} entries</span>
            </div>
          </div>
          <div className="h-80 overflow-y-auto">
            {filteredLogs.length === 0 ? (
              <div className="text-center py-12 text-gray-600 text-sm">No logs yet</div>
            ) : (
              <table className="w-full text-xs">
                <tbody>
                  {filteredLogs.map((l) => (
                    <tr key={l.id} className={`border-b border-gray-800/40 ${LEVEL_BG[l.level]} hover:brightness-125`}>
                      <td className="px-2 py-1 text-gray-600 whitespace-nowrap w-20">{l.timestamp.toLocaleTimeString()}</td>
                      <td className={`px-2 py-1 font-bold w-14 ${LEVEL_COLOR[l.level]}`}>{l.level}</td>
                      <td className="px-2 py-1 text-gray-500 w-20">{l.category}</td>
                      <td className="px-2 py-1 text-gray-300">{l.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div ref={logEndRef} />
          </div>
        </div>
      )}

      {/* ── Trades Tab ──────────────────────────────────────────────────── */}
      {tab === "trades" && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between p-3 border-b border-gray-800">
            <span className="text-xs text-white font-semibold">Trade History ({tradeLogs.length})</span>
            <span className="text-xs text-gray-500">{stats.wins}W / {stats.losses}L</span>
          </div>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            {tradeLogs.length === 0 ? (
              <div className="text-center py-10 text-gray-600 text-sm">No trades logged yet</div>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-gray-800/60 sticky top-0 uppercase tracking-wider font-sans font-bold">
                  <tr>
                    {["Time", "Symbol", "Side", "Entry", "Exit", "Qty", "P&L", "Duration", "Reason"].map((h) => (
                      <th key={h} className="text-left px-3 py-2 text-gray-400 font-bold uppercase tracking-wider font-sans">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tradeLogs.map((t) => (
                    <tr key={t.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                      <td className="px-3 py-2 text-gray-500">{t.timestamp.toLocaleTimeString()}</td>
                      <td className="px-3 py-2 text-white font-bold">{t.symbol}</td>
                      <td className={`px-3 py-2 font-bold ${t.side === "BUY" ? "text-green-400" : "text-red-400"}`}>{t.side}</td>
                      <td className="px-3 py-2 text-gray-300">${t.entryPrice.toFixed(4)}</td>
                      <td className="px-3 py-2 text-gray-400">{t.exitPrice ? `$${t.exitPrice.toFixed(4)}` : "—"}</td>
                      <td className="px-3 py-2 text-gray-400">{t.qty}</td>
                      <td className={`px-3 py-2 font-bold ${(t.pnl ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {t.pnl !== undefined ? `${t.pnl >= 0 ? "+" : ""}$${t.pnl.toFixed(2)}` : "—"}
                      </td>
                      <td className="px-3 py-2 text-gray-500">
                        {t.durationMs ? `${Math.round(t.durationMs / 60000)}m` : "—"}
                      </td>
                      <td className={`px-3 py-2 text-sm font-semibold ${
                        t.exitReason === "TP" ? "text-green-400" :
                        t.exitReason === "SL" ? "text-red-400" :
                        t.status === "OPEN" ? "text-cyan-400" : "text-gray-500"
                      }`}>
                        {t.exitReason ?? t.status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── Stats Tab ───────────────────────────────────────────────────── */}
      {tab === "stats" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
            <h3 className="text-white font-semibold text-sm">📊 Trade Statistics</h3>
            {[
              ["Total Trades",     stats.totalTrades,                   ""],
              ["Open Trades",      stats.openTrades,                    ""],
              ["Winning Trades",   stats.wins,                          ""],
              ["Losing Trades",    stats.losses,                        ""],
              ["Win Rate",         `${stats.winRate}%`,                 stats.winRate >= 50 ? "text-green-400" : "text-red-400"],
              ["Profit Factor",    stats.profitFactor,                  stats.profitFactor >= 1.5 ? "text-green-400" : "text-yellow-400"],
              ["Avg Win",          `$${stats.avgWin.toFixed(2)}`,       "text-green-400"],
              ["Avg Loss",         `$${stats.avgLoss.toFixed(2)}`,      "text-red-400"],
              ["Best Trade",       `$${stats.bestTrade.toFixed(2)}`,    "text-green-400"],
              ["Worst Trade",      `$${stats.worstTrade.toFixed(2)}`,   "text-red-400"],
              ["Total P&L",        `$${stats.totalPnL.toFixed(2)}`,     stats.totalPnL >= 0 ? "text-green-400" : "text-red-400"],
              ["Max Drawdown",     `$${stats.maxDrawdown.toFixed(2)}`,  "text-red-400"],
            ].map(([label, value, color]) => (
              <div key={label as string} className="flex justify-between text-xs border-b border-gray-800/50 pb-1.5">
                <span className="text-gray-500">{label}</span>
                <span className={`font-bold ${color || "text-white"}`}>{value}</span>
              </div>
            ))}
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-4">
            <h3 className="text-white font-semibold text-sm">⚡ Session Info</h3>
            <div className="bg-gray-800/60 rounded-lg p-3 text-xs">
              <p className="text-cyan-300">Session ID</p>
              <p className="text-gray-400 break-all">{logger.getSessionId()}</p>
            </div>
            <div className="space-y-2 text-xs">
              {[
                ["Log Entries",   logs.length,      "text-blue-300"],
                ["Trade Records", tradeLogs.length,  "text-green-300"],
                ["Storage",       "localStorage",    "text-yellow-300"],
                ["Retention",     "2000 logs / 500 trades", "text-gray-400"],
                ["Persistence",   "Cross-session ✅",  "text-green-400"],
              ].map(([label, value, color]) => (
                <div key={label as string} className="flex justify-between border-b border-gray-800/50 pb-1.5">
                  <span className="text-gray-500">{label}</span>
                  <span className={`font-semibold ${color}`}>{value}</span>
                </div>
              ))}
            </div>

            <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-lg p-3 text-xs text-yellow-300/70">
              💾 All logs and trades are persisted in <strong>localStorage</strong> and survive page reloads.
              Export to CSV for VPS/long-term record keeping.
            </div>
          </div>
        </div>
      )}

      {/* ── Equity Curve Tab ────────────────────────────────────────────── */}
      {tab === "equity" && (
        <div className="space-y-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <h3 className="text-white font-semibold text-sm mb-4">📈 Equity Curve</h3>
            {equityValues.length < 2 ? (
              <div className="text-center py-12 text-gray-600">
                <p className="text-3xl mb-3">📈</p>
                <p className="text-sm">Equity curve builds as trades execute</p>
                <p className="text-xs text-gray-700 mt-1">Snapshots every bot tick</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* SVG equity curve */}
                <div className="relative">
                  <svg width="100%" height="140" viewBox={`0 0 800 140`} preserveAspectRatio="none" className="rounded-lg bg-gray-800/30">
                    <defs>
                      <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.3" />
                        <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    {/* Grid lines */}
                    {[0, 35, 70, 105, 140].map((y) => (
                      <line key={y} x1="0" y1={y} x2="800" y2={y} stroke="#374151" strokeWidth="0.5" strokeDasharray="4,4" />
                    ))}
                    {/* Area fill */}
                    <polygon
                      points={[
                        "0,140",
                        ...equityValues.map((v, i) => {
                          const x = (i / (equityValues.length - 1)) * 800;
                          const y = 140 - ((v - equityMin) / (equityMax - equityMin || 1)) * 130;
                          return `${x},${y}`;
                        }),
                        "800,140",
                      ].join(" ")}
                      fill="url(#eqGrad)"
                    />
                    {/* Line */}
                    <polyline
                      points={equityValues.map((v, i) => {
                        const x = (i / (equityValues.length - 1)) * 800;
                        const y = 140 - ((v - equityMin) / (equityMax - equityMin || 1)) * 130;
                        return `${x},${y}`;
                      }).join(" ")}
                      fill="none" stroke="#22d3ee" strokeWidth="2" strokeLinejoin="round"
                    />
                    {/* Labels */}
                    <text x="4" y="12" fill="#6b7280" fontSize="9">${equityMax.toFixed(0)}</text>
                    <text x="4" y="136" fill="#6b7280" fontSize="9">${equityMin.toFixed(0)}</text>
                  </svg>
                </div>

                {/* Drawdown chart */}
                <div>
                  <p className="text-xs text-gray-500 mb-2">Drawdown %</p>
                  <svg width="100%" height="50" viewBox="0 0 800 50" preserveAspectRatio="none" className="rounded-lg bg-gray-800/20">
                    <polygon
                      points={[
                        "0,0",
                        ...drawdownValues.map((v, i) => {
                          const x = (i / (drawdownValues.length - 1)) * 800;
                          const y = (v / 20) * 50;
                          return `${x},${y}`;
                        }),
                        "800,0",
                      ].join(" ")}
                      fill="#ef4444" fillOpacity="0.2"
                    />
                    <polyline
                      points={drawdownValues.map((v, i) => {
                        const x = (i / (drawdownValues.length - 1)) * 800;
                        const y = (v / 20) * 50;
                        return `${x},${y}`;
                      }).join(" ")}
                      fill="none" stroke="#ef4444" strokeWidth="1.5"
                    />
                  </svg>
                </div>
              </div>
            )}
          </div>

          {/* VPS deployment note */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <h3 className="text-white font-semibold text-sm mb-3">🖥️ VPS 24/7 Deployment</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                {
                  title: "1. Build & Deploy",
                  code: "npm run build\nnpm install -g serve\nserve -s dist -p 3000",
                  color: "border-cyan-500/20",
                },
                {
                  title: "2. PM2 Process Manager (24/7)",
                  code: "npm install -g pm2\npm2 serve dist 3000 --spa\npm2 startup\npm2 save",
                  color: "border-green-500/20",
                },
                {
                  title: "3. Nginx Reverse Proxy",
                  code: "server {\n  listen 80;\n  location / {\n    proxy_pass http://localhost:3000;\n  }\n}",
                  color: "border-yellow-500/20",
                },
                {
                  title: "4. SSL + Domain (Certbot)",
                  code: "apt install certbot python3-certbot-nginx\ncertbot --nginx -d yourdomain.com\n# Auto-renews every 90 days",
                  color: "border-purple-500/20",
                },
                {
                  title: "5. Systemd Auto-restart",
                  code: "[Unit]\nAfter=network.target\n[Service]\nExecStart=/usr/bin/pm2 resurrect\nRestart=always\n[Install]\nWantedBy=multi-user.target",
                  color: "border-orange-500/20",
                },
                {
                  title: "6. Log Rotation (logrotate)",
                  code: "/root/.pm2/logs/*.log {\n  daily\n  rotate 7\n  compress\n  missingok\n  notifempty\n}",
                  color: "border-blue-500/20",
                },
              ].map(({ title, code, color }) => (
                <div key={title} className={`bg-gray-800/40 border rounded-xl p-3 ${color}`}>
                  <p className="text-xs text-white font-semibold mb-2">{title}</p>
                  <pre className="text-xs text-gray-400 bg-gray-900/60 rounded p-2 overflow-x-auto whitespace-pre">{code}</pre>
                </div>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              {[
                { icon: "🖥️", title: "Recommended VPS", body: "DigitalOcean / Hetzner / Vultr\n1 vCPU · 1GB RAM · 25GB SSD\n~$5-6/month · 99.9% uptime" },
                { icon: "📊", title: "Monitoring", body: "pm2 monit\npm2 logs --lines 100\npm2 status\nhtop (system resources)" },
                { icon: "🔒", title: "Security", body: "UFW firewall: ports 22, 80, 443\nSSH key auth only (no passwords)\nFail2ban for brute-force protection\nNever expose Binance API IP-unrestricted" },
              ].map(({ icon, title, body }) => (
                <div key={title} className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-3">
                  <p className="text-white font-semibold mb-2">{icon} {title}</p>
                  <pre className="text-xs text-gray-400 whitespace-pre-wrap">{body}</pre>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
