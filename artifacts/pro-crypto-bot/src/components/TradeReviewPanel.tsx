import { useState, useEffect, useCallback } from "react";
import { SERVER_URL } from "../config/urls";

interface TradeReview {
  tradeId: string; symbol: string; strategyId: string;
  outcome: "win" | "loss" | "breakeven"; pnlUsd: number; pnlPct: number;
  entryRationale: string; exitRationale: string;
  strengths: string[]; weaknesses: string[]; lessons: string[];
  rating: number; createdAt: string;
}

interface ReviewStats { total: number; wins: number; losses: number; avgRating: number; }

function RatingStars({ rating }: { rating: number }) {
  const full = Math.floor(rating / 2);
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: 5 }).map((_, i) => (
        <span key={i} className={i < full ? "text-yellow-400" : "text-gray-700"}>★</span>
      ))}
      <span className="text-xs text-gray-400 ml-1">{rating}/10</span>
    </div>
  );
}

export function TradeReviewPanel() {
  const [reviews, setReviews]   = useState<TradeReview[]>([]);
  const [stats,   setStats]     = useState<ReviewStats | null>(null);
  const [selected, setSelected] = useState<TradeReview | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [filter,   setFilter]   = useState<"all" | "win" | "loss">("all");

  const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("pcb_jwt") ?? ""}` });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rRes, sRes] = await Promise.all([
        fetch(`${SERVER_URL}/api/trade-review/recent?limit=50`, { headers: auth() }),
        fetch(`${SERVER_URL}/api/trade-review/stats`,           { headers: auth() }),
      ]);
      const [rData, sData] = await Promise.all([rRes.json(), sRes.json()]) as [{ ok: boolean; data?: TradeReview[] }, { ok: boolean; data?: ReviewStats }];
      if (rData.ok && rData.data) setReviews(rData.data);
      if (sData.ok && sData.data) setStats(sData.data);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => clearInterval(id);
  }, [load]);

  const filtered = filter === "all" ? reviews : reviews.filter((r) => r.outcome === filter);

  const OUTCOME_STYLES: Record<string, string> = {
    win:       "text-green-400 bg-green-500/10 border-green-500/30",
    loss:      "text-red-400 bg-red-500/10 border-red-500/30",
    breakeven: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">🤖 AI Trade Review</h2>
          <p className="text-xs text-gray-400 mt-0.5">Post-trade analysis: entry/exit rationale, strengths, lessons</p>
        </div>
        <button onClick={() => void load()} disabled={loading}
          className="text-xs px-3 py-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-400">{loading ? "…" : "↻"}</button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Reviews",     value: stats.total, color: "text-white" },
            { label: "Wins",        value: stats.wins,  color: "text-green-400" },
            { label: "Losses",      value: stats.losses, color: "text-red-400" },
            { label: "Avg Rating",  value: `${stats.avgRating}/10`, color: "text-yellow-400" },
          ].map((s) => (
            <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-xl p-3">
              <p className="text-xs text-gray-400">{s.label}</p>
              <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-2">
        {(["all","win","loss"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${filter === f ? "bg-cyan-500/20 border-cyan-500/40 text-cyan-300" : "bg-gray-900 border-gray-800 text-gray-400 hover:border-gray-700"}`}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Empty state */}
      {filtered.length === 0 && !loading && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-10 text-center">
          <p className="text-3xl mb-2">🤖</p>
          <p className="text-gray-400 text-sm">No trade reviews yet.</p>
          <p className="text-gray-500 text-xs mt-1">Reviews are generated automatically after each completed trade.</p>
        </div>
      )}

      {/* Reviews list */}
      <div className="space-y-3">
        {filtered.map((r) => (
          <div key={r.tradeId} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="p-4 cursor-pointer" onClick={() => setSelected(selected?.tradeId === r.tradeId ? null : r)}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="text-xl">{r.outcome === "win" ? "✅" : r.outcome === "loss" ? "❌" : "➖"}</span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white">{r.symbol}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full border font-bold ${OUTCOME_STYLES[r.outcome]}`}>
                        {r.outcome.toUpperCase()}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400">{r.strategyId} · {new Date(r.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className={`text-sm font-bold ${r.pnlUsd >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {r.pnlUsd >= 0 ? "+" : ""}${r.pnlUsd.toFixed(2)}
                  </p>
                  <RatingStars rating={r.rating} />
                </div>
              </div>
            </div>

            {selected?.tradeId === r.tradeId && (
              <div className="border-t border-gray-800 p-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-semibold text-cyan-400 mb-1">📈 Entry Rationale</p>
                    <p className="text-xs text-gray-300 leading-relaxed">{r.entryRationale}</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-orange-400 mb-1">📉 Exit Rationale</p>
                    <p className="text-xs text-gray-300 leading-relaxed">{r.exitRationale}</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm font-semibold text-green-400 mb-2">💪 Strengths</p>
                    <ul className="space-y-1">
                      {r.strengths.map((s, i) => <li key={i} className="text-xs text-gray-300 flex gap-1.5"><span className="text-green-400 shrink-0">✓</span>{s}</li>)}
                    </ul>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-red-400 mb-2">⚠️ Weaknesses</p>
                    <ul className="space-y-1">
                      {r.weaknesses.map((w, i) => <li key={i} className="text-xs text-gray-300 flex gap-1.5"><span className="text-red-400 shrink-0">✗</span>{w}</li>)}
                    </ul>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-yellow-400 mb-2">📚 Lessons</p>
                    <ul className="space-y-1">
                      {r.lessons.map((l, i) => <li key={i} className="text-xs text-gray-300 flex gap-1.5"><span className="text-yellow-400 shrink-0">→</span>{l}</li>)}
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
