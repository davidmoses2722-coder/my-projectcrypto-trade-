import { useState, useEffect, useCallback, useMemo } from "react";
import { SERVER_URL } from "../config/urls";

interface JournalEntry {
  id: string; tradeId: string; symbol: string; strategyId: string; strategyName: string;
  side: "buy" | "sell"; entryPrice: number; exitPrice: number | null;
  pnlUsd: number | null; pnlPct: number | null; marketRegime: string;
  reasoning: string; confidence: number; tags: string[]; notes: string;
  status: "open" | "closed" | "cancelled"; entryTime: string; exitTime: string | null;
  createdAt: string; updatedAt: string;
}

interface TradeReview {
  tradeId: string; symbol: string; strategyId: string;
  outcome: "win" | "loss" | "breakeven"; pnlUsd: number;
  entryRationale: string; exitRationale: string;
  strengths: string[]; weaknesses: string[]; lessons: string[];
  rating: number; createdAt: string;
}

interface JournalStats {
  totalEntries: number; openEntries: number; closedEntries: number;
  winCount: number; lossCount: number; avgConfidence: number;
  topRegimes: { regime: string; count: number }[];
  topStrategies: { strategyId: string; count: number }[];
}

interface ExecutionSummary {
  avgSlippagePct: number; avgFillMs: number; totalRecords: number;
  slippageBySymbol: Record<string, { avg: number; count: number }>;
}

function ConfidenceBar({ value }: { value: number }) {
  const color = value >= 75 ? "bg-green-400" : value >= 50 ? "bg-yellow-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs text-gray-400">{value}%</span>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-gray-700" />
          <div className="space-y-1.5">
            <div className="w-32 h-3 bg-gray-700 rounded" />
            <div className="w-48 h-2.5 bg-gray-800 rounded" />
          </div>
        </div>
        <div className="w-16 h-4 bg-gray-700 rounded" />
      </div>
    </div>
  );
}

function exportJournalCSV(entries: JournalEntry[]) {
  const headers = [
    "id","tradeId","symbol","strategyId","side","entryPrice","exitPrice",
    "pnlUsd","pnlPct","marketRegime","status","confidence","tags","notes",
    "entryTime","exitTime","createdAt"
  ];
  const rows = entries.map((e) =>
    headers.map((h) => {
      const v = e[h as keyof JournalEntry];
      if (Array.isArray(v)) return `"${v.join(";")}"`;
      if (v === null || v === undefined) return "";
      const s = String(v);
      return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(",")
  );
  const csv  = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `trade-journal-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Compact inline AI review summary for a trade
function AIReviewBadge({ review }: { review: TradeReview | undefined }) {
  const [open, setOpen] = useState(false);
  if (!review) return <span className="text-xs text-gray-700 italic">No review</span>;
  const colorCls =
    review.outcome === "win"  ? "text-green-400 bg-green-500/10 border-green-500/30" :
    review.outcome === "loss" ? "text-red-400 bg-red-500/10 border-red-500/30" :
                                "text-yellow-400 bg-yellow-500/10 border-yellow-500/30";
  return (
    <div className="relative inline-block">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className={`text-xs px-2 py-0.5 rounded border font-medium ${colorCls}`}
      >
        AI {review.rating}/10
      </button>
      {open && (
        <div
          className="absolute z-20 left-0 top-6 w-64 bg-gray-900 border border-gray-700 rounded-xl p-3 shadow-xl space-y-2"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-sm font-semibold text-cyan-400">AI Trade Review</p>
          <p className="text-xs text-gray-300 leading-relaxed line-clamp-3">{review.entryRationale}</p>
          {review.strengths.length > 0 && (
            <p className="text-xs text-green-400">+ {review.strengths[0]}</p>
          )}
          {review.weaknesses.length > 0 && (
            <p className="text-xs text-red-400">- {review.weaknesses[0]}</p>
          )}
          <button onClick={() => setOpen(false)} className="text-xs text-gray-600 hover:text-gray-400">Close</button>
        </div>
      )}
    </div>
  );
}

export function TradeJournalView() {
  const [entries, setEntries]           = useState<JournalEntry[]>([]);
  const [stats,   setStats]             = useState<JournalStats | null>(null);
  const [reviews, setReviews]           = useState<TradeReview[]>([]);
  const [execSummary, setExecSummary]   = useState<ExecutionSummary | null>(null);
  const [loading, setLoading]           = useState(false);
  const [search,  setSearch]            = useState("");
  const [stratFilter, setStratFilter]   = useState("all");
  const [statusFilter, setStatus]       = useState<"" | "open" | "closed" | "cancelled">("");
  const [symbolFilter, setSymbolFilter] = useState("");
  const [dateFrom, setDateFrom]         = useState("");
  const [dateTo,   setDateTo]           = useState("");
  const [selected, setSelected]         = useState<JournalEntry | null>(null);
  const [showAdd,  setShowAdd]          = useState(false);
  const [editingNotes, setEditingNotes] = useState<{ id: string; notes: string } | null>(null);
  const [newEntry, setNewEntry]         = useState({
    symbol: "BTC/USDT", strategyId: "swing", reasoning: "", confidence: 70, notes: "", tags: "",
  });

  const auth = () => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${localStorage.getItem("pcb_jwt") ?? ""}`,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (stratFilter !== "all") params.set("strategyId", stratFilter);
      if (statusFilter)          params.set("status", statusFilter);
      if (symbolFilter)          params.set("symbol", symbolFilter);
      if (dateFrom)              params.set("from", dateFrom);
      if (dateTo)                params.set("to", dateTo);
      params.set("limit", "100");

      const [eRes, sRes, rRes, xRes] = await Promise.all([
        fetch(`${SERVER_URL}/api/trade-journal?${params}`, { headers: auth() }),
        fetch(`${SERVER_URL}/api/trade-journal/stats`,     { headers: auth() }),
        fetch(`${SERVER_URL}/api/trade-review/recent?limit=100`, { headers: auth() }),
        fetch(`${SERVER_URL}/api/execution-analytics/summary`,   { headers: auth() }),
      ]);
      const [eData, sData, rData, xData] = await Promise.all([
        eRes.json(), sRes.json(), rRes.json(), xRes.json(),
      ]) as [
        { ok: boolean; data?: JournalEntry[] },
        { ok: boolean; data?: JournalStats },
        { ok: boolean; data?: TradeReview[] },
        { ok: boolean; data?: ExecutionSummary },
      ];
      if (eData.ok && eData.data) setEntries(eData.data);
      if (sData.ok && sData.data) setStats(sData.data);
      if (rData.ok && rData.data) setReviews(rData.data);
      if (xData.ok && xData.data) setExecSummary(xData.data);
    } finally { setLoading(false); }
  }, [stratFilter, statusFilter, symbolFilter, dateFrom, dateTo]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => clearInterval(id);
  }, [load]);

  const addEntry = async () => {
    const res = await fetch(`${SERVER_URL}/api/trade-journal`, {
      method: "POST", headers: auth(),
      body: JSON.stringify({
        tradeId: `manual_${Date.now()}`, symbol: newEntry.symbol,
        strategyId: newEntry.strategyId, strategyName: newEntry.strategyId,
        side: "buy", entryPrice: 0, exitPrice: null, pnlUsd: null, pnlPct: null,
        marketRegime: "unknown", reasoning: newEntry.reasoning,
        confidence: newEntry.confidence,
        tags: newEntry.tags.split(",").map((t) => t.trim()).filter(Boolean),
        notes: newEntry.notes, status: "open",
        entryTime: new Date().toISOString(), exitTime: null,
      }),
    });
    const d = await res.json() as { ok: boolean };
    if (d.ok) { setShowAdd(false); void load(); }
  };

  const saveNotes = async (id: string, notes: string) => {
    await fetch(`${SERVER_URL}/api/trade-journal/${id}`, {
      method: "PATCH", headers: auth(),
      body: JSON.stringify({ notes }),
    });
    setEditingNotes(null);
    void load();
  };

  const reviewMap = useMemo(() => {
    const m = new Map<string, TradeReview>();
    for (const r of reviews) m.set(r.tradeId, r);
    return m;
  }, [reviews]);

  const filtered = useMemo(() => entries.filter((e) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      e.symbol.toLowerCase().includes(q) ||
      e.reasoning.toLowerCase().includes(q) ||
      e.notes.toLowerCase().includes(q) ||
      e.tags.some((t) => t.toLowerCase().includes(q)) ||
      e.strategyName.toLowerCase().includes(q)
    );
  }), [entries, search]);

  return (
    <div className="space-y-4">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-white">Trade Journal</h2>
          <p className="text-xs text-gray-400 mt-0.5">Searchable trade history with regime, strategy, and reasoning</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => exportJournalCSV(filtered)}
            disabled={filtered.length === 0}
            className="text-xs px-3 py-1.5 rounded-lg bg-green-500/20 border border-green-500/30 text-green-400 hover:bg-green-500/30 disabled:opacity-40"
          >
            Export CSV ({filtered.length})
          </button>
          <button onClick={() => setShowAdd(true)}
            className="text-xs px-3 py-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/25">
            + Add Entry
          </button>
          <button onClick={() => void load()} disabled={loading}
            className="text-xs px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 hover:text-gray-200">
            {loading ? "..." : "Refresh"}
          </button>
        </div>
      </div>

      {/* ── Stats grid ──────────────────────────────────────────────────────── */}
      {stats ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total Entries",   value: stats.totalEntries,                           color: "text-white" },
            { label: "Win / Loss",      value: `${stats.winCount} / ${stats.lossCount}`,    color: "text-green-400" },
            { label: "Avg Confidence",  value: `${stats.avgConfidence}%`,                   color: "text-cyan-400" },
            { label: "Open Positions",  value: stats.openEntries,                            color: "text-yellow-400" },
          ].map((s) => (
            <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-xl p-3">
              <p className="text-xs text-gray-400">{s.label}</p>
              <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[0,1,2,3].map((i) => (
            <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-3 h-16 animate-pulse">
              <div className="w-24 h-2.5 bg-gray-700 rounded mb-2" />
              <div className="w-16 h-5 bg-gray-700 rounded" />
            </div>
          ))}
        </div>
      )}

      {/* ── Execution quality strip ─────────────────────────────────────────── */}
      {execSummary && execSummary.totalRecords > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 flex flex-wrap gap-6 text-xs">
          <span className="text-gray-500">Execution Quality</span>
          <span>
            <span className="text-gray-400">Avg slippage </span>
            <span className="text-yellow-400">{execSummary.avgSlippagePct.toFixed(4)}%</span>
          </span>
          <span>
            <span className="text-gray-400">Avg fill time </span>
            <span className="text-cyan-400">{execSummary.avgFillMs.toFixed(0)}ms</span>
          </span>
          <span>
            <span className="text-gray-400">Records </span>
            <span className="text-gray-300">{execSummary.totalRecords}</span>
          </span>
        </div>
      )}

      {/* ── Filters ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search symbol, reasoning, notes, tags..."
          className="flex-1 min-w-48 bg-gray-900 border border-gray-800 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-600"
        />
        <input
          value={symbolFilter}
          onChange={(e) => setSymbolFilter(e.target.value)}
          placeholder="Symbol..."
          className="w-32 bg-gray-900 border border-gray-800 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-600"
        />
        <select
          value={stratFilter}
          onChange={(e) => setStratFilter(e.target.value)}
          className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-1.5 text-sm text-white"
        >
          <option value="all">All Strategies</option>
          {["scalping","day-trading","swing","dca","grid"].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatus(e.target.value as "" | "open" | "closed" | "cancelled")}
          className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-1.5 text-sm text-white"
        >
          <option value="">All Status</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-1.5 text-sm text-white"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-1.5 text-sm text-white"
        />
        {(search || symbolFilter || stratFilter !== "all" || statusFilter || dateFrom || dateTo) && (
          <button
            onClick={() => { setSearch(""); setSymbolFilter(""); setStratFilter("all"); setStatus(""); setDateFrom(""); setDateTo(""); }}
            className="text-xs px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-gray-200 border border-gray-700"
          >
            Clear
          </button>
        )}
      </div>

      {/* ── Add entry form ─────────────────────────────────────────────────── */}
      {showAdd && (
        <div className="bg-gray-900 border border-cyan-500/30 rounded-xl p-4 space-y-3">
          <p className="text-sm font-bold text-white">Add Manual Journal Entry</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Symbol</label>
              <input
                value={newEntry.symbol}
                onChange={(e) => setNewEntry((p) => ({ ...p, symbol: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Strategy</label>
              <select
                value={newEntry.strategyId}
                onChange={(e) => setNewEntry((p) => ({ ...p, strategyId: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white"
              >
                {["scalping","day-trading","swing","dca","grid"].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Reasoning</label>
            <textarea
              value={newEntry.reasoning}
              onChange={(e) => setNewEntry((p) => ({ ...p, reasoning: e.target.value }))}
              rows={2}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Notes</label>
            <input
              value={newEntry.notes}
              onChange={(e) => setNewEntry((p) => ({ ...p, notes: e.target.value }))}
              placeholder="Optional trade notes..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Confidence: {newEntry.confidence}%</label>
              <input
                type="range" min={0} max={100} value={newEntry.confidence}
                onChange={(e) => setNewEntry((p) => ({ ...p, confidence: Number(e.target.value) }))}
                className="w-full"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Tags (comma-separated)</label>
              <input
                value={newEntry.tags}
                onChange={(e) => setNewEntry((p) => ({ ...p, tags: e.target.value }))}
                placeholder="breakout, momentum..."
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => void addEntry()}
              className="flex-1 py-2 bg-green-500 hover:bg-green-600 text-white text-sm font-bold rounded-lg">
              Save Entry
            </button>
            <button onClick={() => setShowAdd(false)}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Entry list ─────────────────────────────────────────────────────── */}
      {loading && entries.length === 0 ? (
        <div className="space-y-2">
          {[0,1,2,3].map((i) => <SkeletonRow key={i} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-10 text-center">
          <p className="text-gray-500 text-sm">No journal entries match the current filters.</p>
          {(search || statusFilter || stratFilter !== "all") && (
            <p className="text-gray-600 text-xs mt-1">Try clearing the filters above.</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((e) => {
            const review  = reviewMap.get(e.tradeId);
            const isOpen  = selected?.id === e.id;
            const isWin   = (e.pnlUsd ?? 0) > 0;
            const statusDot =
              e.status === "open"      ? "bg-green-400 animate-pulse" :
              e.status === "cancelled" ? "bg-gray-500" :
              isWin                    ? "bg-green-400" : "bg-red-400";

            return (
              <div
                key={e.id}
                className={`bg-gray-900 border rounded-xl overflow-hidden cursor-pointer transition-colors ${
                  isOpen ? "border-cyan-500/40" : "border-gray-800 hover:border-gray-700"
                }`}
                onClick={() => setSelected(isOpen ? null : e)}
              >
                {/* ── Row summary ── */}
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full mt-1 shrink-0 ${statusDot}`} />
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold text-white">{e.symbol}</span>
                          <span className="text-xs text-gray-500">{e.strategyName}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
                            e.status === "open"      ? "bg-blue-500/20 text-blue-400" :
                            e.status === "cancelled" ? "bg-gray-500/20 text-gray-400" :
                            isWin                    ? "bg-green-500/20 text-green-400" :
                                                       "bg-red-500/20 text-red-400"
                          }`}>
                            {e.status === "open" ? "OPEN" : e.status === "cancelled" ? "CANCELLED" : isWin ? "WIN" : "LOSS"}
                          </span>
                          <span className="text-xs text-gray-600 capitalize">{e.side}</span>
                          {/* Inline AI review badge */}
                          <AIReviewBadge review={review} />
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">
                          {e.reasoning || "No reasoning recorded"}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      {e.pnlUsd != null && (
                        <p className={`text-sm font-bold ${e.pnlUsd >= 0 ? "text-green-400" : "text-red-400"}`}>
                          {e.pnlUsd >= 0 ? "+" : ""}${e.pnlUsd.toFixed(2)}
                        </p>
                      )}
                      <ConfidenceBar value={e.confidence} />
                    </div>
                  </div>
                </div>

                {/* ── Expanded detail ── */}
                {isOpen && (
                  <div className="border-t border-gray-800 bg-gray-900/50 p-4 space-y-4">

                    {/* Trade lifecycle timeline */}
                    <div>
                      <p className="text-sm font-semibold text-gray-400 mb-2">Trade Timeline</p>
                      <ol className="relative border-l border-gray-700 ml-2 space-y-2">
                        <li className="ml-4">
                          <span className="absolute -left-1.5 w-3 h-3 rounded-full bg-green-500/80" />
                          <p className="text-xs text-gray-400">
                            <span className="font-semibold text-white">Opened</span>
                            {" · "}@${e.entryPrice > 0 ? e.entryPrice.toFixed(4) : "—"}
                            {" · "}
                            <span className="text-gray-500">{new Date(e.entryTime).toLocaleString()}</span>
                          </p>
                          {e.reasoning && (
                            <p className="text-xs text-gray-500 mt-0.5 italic">{e.reasoning}</p>
                          )}
                        </li>
                        {e.status === "closed" && e.exitTime && (
                          <li className="ml-4">
                            <span className={`absolute -left-1.5 w-3 h-3 rounded-full ${isWin ? "bg-green-400" : "bg-red-400"}`} />
                            <p className="text-xs text-gray-400">
                              <span className="font-semibold text-white">Closed</span>
                              {e.exitPrice ? ` · @$${e.exitPrice.toFixed(4)}` : ""}
                              {e.pnlUsd != null ? ` · ${e.pnlUsd >= 0 ? "+" : ""}$${e.pnlUsd.toFixed(2)}` : ""}
                              {" · "}
                              <span className="text-gray-500">{new Date(e.exitTime).toLocaleString()}</span>
                            </p>
                          </li>
                        )}
                        {e.status === "open" && (
                          <li className="ml-4">
                            <span className="absolute -left-1.5 w-3 h-3 rounded-full bg-cyan-400 animate-pulse" />
                            <p className="text-xs text-cyan-400">Position still open</p>
                          </li>
                        )}
                        {e.status === "cancelled" && (
                          <li className="ml-4">
                            <span className="absolute -left-1.5 w-3 h-3 rounded-full bg-gray-500" />
                            <p className="text-xs text-gray-500">Cancelled</p>
                          </li>
                        )}
                      </ol>
                    </div>

                    {/* Core fields */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                      <div><span className="text-gray-500">Regime: </span><span className="text-white capitalize">{e.marketRegime}</span></div>
                      <div><span className="text-gray-500">Entry: </span><span className="text-white">${e.entryPrice > 0 ? e.entryPrice.toFixed(4) : "—"}</span></div>
                      {e.exitPrice != null && <div><span className="text-gray-500">Exit: </span><span className="text-white">${e.exitPrice.toFixed(4)}</span></div>}
                      {e.pnlPct != null && <div><span className="text-gray-500">PnL %: </span><span className={e.pnlPct >= 0 ? "text-green-400" : "text-red-400"}>{e.pnlPct >= 0 ? "+" : ""}{e.pnlPct.toFixed(2)}%</span></div>}
                      <div><span className="text-gray-500">Entry date: </span><span className="text-white">{new Date(e.entryTime).toLocaleDateString()}</span></div>
                      {e.exitTime && <div><span className="text-gray-500">Exit date: </span><span className="text-white">{new Date(e.exitTime).toLocaleDateString()}</span></div>}
                    </div>

                    {/* Tags */}
                    {e.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {e.tags.map((t) => (
                          <span key={t} className="text-xs px-2 py-0.5 bg-gray-800 border border-gray-700 rounded-full text-gray-400">#{t}</span>
                        ))}
                      </div>
                    )}

                    {/* Notes (editable, persisted via PATCH) */}
                    <div>
                      <div className="flex items-center gap-2 mb-1.5">
                        <p className="text-sm font-semibold text-gray-400">Notes</p>
                        {editingNotes?.id !== e.id && (
                          <button
                            onClick={(ev) => { ev.stopPropagation(); setEditingNotes({ id: e.id, notes: e.notes }); }}
                            className="text-xs text-cyan-500 hover:text-cyan-400"
                          >
                            Edit
                          </button>
                        )}
                      </div>
                      {editingNotes?.id === e.id ? (
                        <div className="space-y-2" onClick={(ev) => ev.stopPropagation()}>
                          <textarea
                            value={editingNotes.notes}
                            onChange={(ev) => setEditingNotes({ id: e.id, notes: ev.target.value })}
                            rows={3}
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-cyan-600"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => void saveNotes(e.id, editingNotes.notes)}
                              className="text-xs px-3 py-1 bg-cyan-500 hover:bg-cyan-600 text-white rounded-lg font-medium"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingNotes(null)}
                              className="text-xs px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded-lg"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400 italic">
                          {e.notes || <span className="text-gray-600">No notes. Click Edit to add.</span>}
                        </p>
                      )}
                    </div>

                    {/* Screenshot placeholder */}
                    <div className="border border-dashed border-gray-700 rounded-xl p-4 text-center">
                      <p className="text-xs text-gray-600">Screenshot — coming soon</p>
                      <p className="text-xs text-gray-700 mt-0.5">Chart screenshot upload not yet available</p>
                    </div>

                    {/* AI review detail */}
                    {review && (
                      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-3 space-y-2">
                        <p className="text-sm font-semibold text-cyan-400">AI Trade Review — {review.rating}/10</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <p className="text-sm font-medium text-gray-400 mb-1">Entry Rationale</p>
                            <p className="text-xs text-gray-300 leading-relaxed">{review.entryRationale}</p>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-400 mb-1">Exit Rationale</p>
                            <p className="text-xs text-gray-300 leading-relaxed">{review.exitRationale}</p>
                          </div>
                        </div>
                        {review.lessons.length > 0 && (
                          <div>
                            <p className="text-sm font-medium text-yellow-400 mb-1">Lessons</p>
                            <ul className="space-y-0.5">
                              {review.lessons.map((l, i) => (
                                <li key={i} className="text-xs text-gray-400 flex gap-1.5">
                                  <span className="text-yellow-500 shrink-0">-&gt;</span>{l}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
