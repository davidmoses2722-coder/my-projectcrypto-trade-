/**
 * NewsFilter — Live news feed with sentiment filter, coin filter, impact scoring
 */

import { useState } from "react";
import { UseNewsReturn } from "../hooks/useNews";
import { NewsItem, NewsSentiment, NewsImpact, NewsSource } from "../services/news";

const COINS   = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "AVAX", "DOGE"];
const SOURCES: NewsSource[] = ["CoinDesk", "Cointelegraph", "Bloomberg", "Reuters", "Twitter", "Reddit", "Other"];

function timeAgo(d: Date): string {
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 1)   return "Just now";
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function SentimentBadge({ s }: { s: NewsItem["sentiment"] }) {
  const cfg = {
    positive: "bg-green-500/15 border-green-500/30 text-green-400",
    negative: "bg-red-500/15 border-red-500/30 text-red-400",
    neutral:  "bg-gray-500/15 border-gray-500/30 text-gray-400",
  }[s];
  const icon = s === "positive" ? "📈" : s === "negative" ? "📉" : "➡️";
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-full border font-semibold ${cfg}`}>
      {icon} {s.charAt(0).toUpperCase() + s.slice(1)}
    </span>
  );
}

function ImpactBadge({ impact, score }: { impact: NewsItem["impact"]; score: number }) {
  const cfg = {
    high:   "bg-red-500/15 border-red-500/30 text-red-400",
    medium: "bg-yellow-500/15 border-yellow-500/30 text-yellow-400",
    low:    "bg-gray-500/15 border-gray-500/30 text-gray-500",
  }[impact];
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-full border font-semibold ${cfg}`}>
      {score}/10
    </span>
  );
}

function PriceEffectIcon({ effect }: { effect: NewsItem["priceEffect"] }) {
  return (
    <span className={`text-lg leading-none ${
      effect === "pump" ? "text-green-400" : effect === "dump" ? "text-red-400" : "text-gray-600"
    }`}>
      {effect === "pump" ? "🚀" : effect === "dump" ? "💥" : "💤"}
    </span>
  );
}

function CoinTag({ coin }: { coin: string }) {
  const colors: Record<string, string> = {
    BTC: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
    ETH: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    SOL: "bg-purple-500/15 text-purple-400 border-purple-500/30",
    BNB: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    XRP: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
    ADA: "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
    AVAX:"bg-red-500/15 text-red-400 border-red-500/30",
    DOGE:"bg-orange-500/15 text-orange-400 border-orange-500/30",
  };
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded-full border font-bold ${colors[coin] ?? "bg-gray-500/15 text-gray-400 border-gray-500/30"}`}>
      {coin}
    </span>
  );
}

function NewsCard({ item }: { item: NewsItem }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      onClick={() => setExpanded(!expanded)}
      className={`rounded-xl border p-3 cursor-pointer transition-all hover:border-gray-700 ${ 
        item.isBreaking ? "bg-red-500/5 border-red-500/20" :
        item.sentiment === "positive" ? "bg-green-500/3 border-gray-800" :
        item.sentiment === "negative" ? "bg-red-500/3 border-gray-800" :
        "bg-gray-900/50 border-gray-800"
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Price effect icon */}
        <div className="shrink-0 mt-0.5">
          <PriceEffectIcon effect={item.priceEffect} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <p className={`text-sm font-semibold text-white leading-snug ${ 
              item.isBreaking ? "text-red-200" : ""
            }`}>
              {item.isBreaking && (
                <span className="inline-flex items-center gap-1 bg-red-500/20 text-red-400 text-xs font-bold px-1.5 py-0.5 rounded-full border border-red-500/30 mr-1.5">
                  🔴 BREAKING
                </span>
              )}
              {item.title}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <SentimentBadge s={item.sentiment} />
            <ImpactBadge impact={item.impact} score={item.impactScore} />
            {item.coins.map((c) => <CoinTag key={c} coin={c} />)}
            <span className="text-xs text-gray-600 font-medium">{item.source}</span>
            <span className="text-xs text-gray-700">{timeAgo(item.publishedAt)}</span>
          </div>

          {expanded && (
            <div className="mt-2 pt-2 border-t border-gray-800 space-y-2">
              {/* Credibility bar */}
              <div className="flex items-center gap-2 text-xs text-gray-600">
                <span>Source credibility:</span>
                <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div style={{ width: `${item.credibility}%` }} className="h-full bg-cyan-500 rounded-full" />
                </div>
                <span className="text-cyan-400">{item.credibility}%</span>
              </div>

              {/* Votes */}
              <div className="flex items-center gap-4 text-xs text-gray-600">
                <span>👍 {item.votes.positive}</span>
                <span>👎 {item.votes.negative}</span>
                <span>⚡ {item.votes.important}</span>
                <span>🔖 {item.votes.saved}</span>
              </div>

              {item.url !== "#" && (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300"
                >
                  Read full article →
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SentimentMeter({ score }: { score: number }) {
  const abs = Math.abs(score);
  const pos = score >= 0;
  const label =
    score >= 40  ? "Very Bullish 🚀" :
    score >= 15  ? "Bullish 📈" :
    score <= -40 ? "Very Bearish 💥" :
    score <= -15 ? "Bearish 📉" : "Neutral ➡️";

  return (
    <div className="rounded-xl bg-gray-900 border border-gray-800 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-gray-300">Market Sentiment</p>
        <span className={`text-xs font-bold ${pos ? "text-green-400" : "text-red-400"}`}>{label}</span>
      </div>
      <div className="h-4 bg-gray-800 rounded-full overflow-hidden flex items-stretch">
        <div className="w-1/2 flex justify-end">
          {!pos && (
            <div style={{ width: `${abs}%` }} className="h-full bg-gradient-to-l from-red-500 to-red-700 rounded-l-full" />
          )}
        </div>
        <div className="w-0.5 bg-gray-600" />
        <div className="w-1/2">
          {pos && (
            <div style={{ width: `${abs}%` }} className="h-full bg-gradient-to-r from-green-500 to-green-700 rounded-r-full" />
          )}
        </div>
      </div>
      <div className="flex justify-between text-xs text-gray-600">
        <span>Bearish −100</span>
        <span className={`font-bold ${pos ? "text-green-400" : "text-red-400"}`}>{pos ? "+" : ""}{score}</span>
        <span>Bullish +100</span>
      </div>
    </div>
  );
}

export function NewsFilterPanel({
  feed, filtered, sentiment, coinSentiments,
  filter, setFilter, isLoading, refresh,
}: UseNewsReturn) {
  const [showFilters, setShowFilters] = useState(false);

  const toggleCoin = (coin: string) => {
    const coins = filter.coins.includes(coin)
      ? filter.coins.filter((c) => c !== coin)
      : [...filter.coins, coin];
    setFilter({ coins });
  };

  const toggleSource = (source: NewsSource) => {
    const sources = filter.sources.includes(source)
      ? filter.sources.filter((s) => s !== source)
      : [...filter.sources, source];
    setFilter({ sources });
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            📰 News & Sentiment Filter
            <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${ 
              feed.isLive
                ? "bg-green-500/15 border-green-500/30 text-green-400"
                : "bg-yellow-500/15 border-yellow-500/30 text-yellow-400"
            }`}>
              {feed.isLive ? "🟢 LIVE" : "🟡 MOCK"} · {feed.lastFetch.toLocaleTimeString()}
            </span>
          </h3>
          <p className="text-xs text-gray-600 mt-0.5">
            {filtered.length} / {feed.totalCount} articles · {sentiment.positive}% bullish · {sentiment.negative}% bearish
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            disabled={isLoading}
            className="text-xs px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-300 transition-all disabled:opacity-50"
          >
            {isLoading ? "⟳ Fetching..." : "↻ Refresh"}
          </button>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${ 
              showFilters
                ? "bg-cyan-500/20 border-cyan-500/40 text-cyan-400"
                : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600"
            }`}
          >
            ⚙ Filters {(filter.coins.length + filter.sources.length > 0) && `(${filter.coins.length + filter.sources.length})`}
          </button>
        </div>
      </div>

      {/* Sentiment meter */}
      <SentimentMeter score={sentiment.score} />

      {/* Coin sentiment chips */}
      <div className="rounded-xl bg-gray-900 border border-gray-800 p-3 space-y-2">
        <p className="text-[13px] font-bold text-gray-500 font-semibold uppercase tracking-wide">Coin Sentiment Scores</p>
        <div className="flex flex-wrap gap-2">
          {COINS.map((coin) => {
            const score = coinSentiments[coin] ?? 0;
            const isPos = score >= 0;
            return (
              <button
                key={coin}
                onClick={() => toggleCoin(coin)}
                className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-all ${ 
                  filter.coins.includes(coin)
                    ? "bg-cyan-500/20 border-cyan-500/40 text-cyan-300"
                    : "bg-gray-800/80 border-gray-700 hover:border-gray-600 text-gray-400"
                }`}
              >
                <span className="font-bold text-gray-200">{coin}</span>
                <span className={`font-bold ${isPos ? "text-green-400" : "text-red-400"}`}>
                  {isPos ? "+" : ""}{score}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="rounded-xl bg-gray-900 border border-gray-800 p-4 space-y-4">
          {/* Sentiment filter */}
          <div className="space-y-2">
            <p className="text-[13px] font-bold text-gray-500 font-semibold uppercase">Sentiment</p>
            <div className="flex gap-2">
              {(["all", "positive", "negative", "neutral"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setFilter({ sentiment: s as NewsSentiment | "all" })}
                  className={`text-xs px-3 py-1.5 rounded-lg border capitalize transition-all ${ 
                    filter.sentiment === s
                      ? s === "positive" ? "bg-green-500/20 border-green-500/40 text-green-400" :
                        s === "negative" ? "bg-red-500/20 border-red-500/40 text-red-400" :
                        s === "neutral"  ? "bg-gray-500/20 border-gray-500/40 text-gray-300" :
                        "bg-cyan-500/20 border-cyan-500/40 text-cyan-400"
                      : "bg-gray-800 border-gray-700 text-gray-500 hover:border-gray-600"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Impact filter */}
          <div className="space-y-2">
            <p className="text-[13px] font-bold text-gray-500 font-semibold uppercase">Impact</p>
            <div className="flex gap-2">
              {(["all", "high", "medium", "low"] as const).map((imp) => (
                <button
                  key={imp}
                  onClick={() => setFilter({ impact: imp as NewsImpact | "all" })}
                  className={`text-xs px-3 py-1.5 rounded-lg border capitalize transition-all ${ 
                    filter.impact === imp
                      ? imp === "high"   ? "bg-red-500/20 border-red-500/40 text-red-400" :
                        imp === "medium" ? "bg-yellow-500/20 border-yellow-500/40 text-yellow-400" :
                        imp === "low"    ? "bg-gray-500/20 border-gray-500/40 text-gray-400" :
                        "bg-cyan-500/20 border-cyan-500/40 text-cyan-400"
                      : "bg-gray-800 border-gray-700 text-gray-500 hover:border-gray-600"
                  }`}
                >
                  {imp}
                </button>
              ))}
            </div>
          </div>

          {/* Min impact score */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-bold text-gray-500 font-semibold uppercase">Min Impact Score</p>
              <span className="text-xs font-bold text-cyan-400">{filter.minImpact}/10</span>
            </div>
            <input
              type="range" min={1} max={10} step={1}
              value={filter.minImpact}
              onChange={(e) => setFilter({ minImpact: Number(e.target.value) })}
              className="w-full accent-cyan-500"
            />
          </div>

          {/* Sources */}
          <div className="space-y-2">
            <p className="text-[13px] font-bold text-gray-500 font-semibold uppercase">Sources</p>
            <div className="flex flex-wrap gap-2">
              {SOURCES.map((source) => (
                <button
                  key={source}
                  onClick={() => toggleSource(source)}
                  className={`text-xs px-2.5 py-1 rounded-lg border transition-all ${ 
                    filter.sources.includes(source)
                      ? "bg-cyan-500/20 border-cyan-500/40 text-cyan-400"
                      : "bg-gray-800 border-gray-700 text-gray-500 hover:border-gray-600"
                  }`}
                >
                  {source}
                </button>
              ))}
            </div>
          </div>

          {/* Max age */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-bold text-gray-500 font-semibold uppercase">Max Age</p>
              <span className="text-xs font-bold text-cyan-400">{filter.maxAge}h</span>
            </div>
            <input
              type="range" min={1} max={72} step={1}
              value={filter.maxAge}
              onChange={(e) => setFilter({ maxAge: Number(e.target.value) })}
              className="w-full accent-cyan-500"
            />
          </div>

          {/* Reset */}
          <button
            onClick={() => setFilter({ coins: [], sentiment: "all", impact: "all", sources: [], maxAge: 24, minImpact: 1 })}
            className="text-xs px-4 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-300 transition-all w-full"
          >
            Reset All Filters
          </button>
        </div>
      )}

      {/* Sentiment breakdown */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "📈 Bullish",  value: sentiment.positive, color: "text-green-400", bg: "bg-green-500" },
          { label: "➡️ Neutral",  value: sentiment.neutral,  color: "text-gray-400",  bg: "bg-gray-500" },
          { label: "📉 Bearish",  value: sentiment.negative, color: "text-red-400",   bg: "bg-red-500"   },
        ].map((s) => (
          <div key={s.label} className="rounded-xl bg-gray-900 border border-gray-800 p-3 text-center space-y-2">
            <p className={`text-xl font-black ${s.color}`}>{s.value}%</p>
            <p className="text-xs text-gray-500">{s.label}</p>
            <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <div style={{ width: `${s.value}%` }} className={`h-full ${s.bg} rounded-full`} />
            </div>
          </div>
        ))}
      </div>

      {/* Trend */}
      <div className={`rounded-xl border px-4 py-3 flex items-center gap-3 ${ 
        sentiment.trend === "improving"     ? "bg-green-500/8 border-green-500/25" :
        sentiment.trend === "deteriorating" ? "bg-red-500/8 border-red-500/25" :
        "bg-gray-800/50 border-gray-700"
      }`}>
        <span className="text-xl">
          {sentiment.trend === "improving" ? "📈" : sentiment.trend === "deteriorating" ? "📉" : "📊"}
        </span>
        <div>
          <p className={`text-xs font-bold ${ 
            sentiment.trend === "improving" ? "text-green-400" :
            sentiment.trend === "deteriorating" ? "text-red-400" : "text-gray-400"
          }`}>
            Sentiment {sentiment.trend === "improving" ? "Improving" :
                       sentiment.trend === "deteriorating" ? "Deteriorating" : "Stable"}
          </p>
          <p className="text-xs text-gray-600">
            Based on {filtered.length} filtered article{filtered.length !== 1 ? "s" : ""} · Weighted by impact score
          </p>
        </div>
      </div>

      {/* News list */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-400">
            {filtered.length} Article{filtered.length !== 1 ? "s" : ""}
          </p>
        </div>
        {isLoading && filtered.length === 0 ? (
          <div className="flex items-center justify-center py-10">
            <div className="text-center">
              <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-gray-500 text-sm">Fetching latest news...</p>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl bg-gray-900 border border-gray-800 py-10 text-center">
            <p className="text-gray-600 text-sm">No news matches your current filters.</p>
            <button
              onClick={() => setFilter({ coins: [], sentiment: "all", impact: "all", sources: [], maxAge: 24, minImpact: 1 })}
              className="mt-2 text-cyan-400 text-xs hover:text-cyan-300"
            >
              Clear filters →
            </button>
          </div>
        ) : (
          <div className="space-y-2 max-h-[600px] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-800 pr-1">
            {filtered.map((item) => <NewsCard key={item.id} item={item} />)}
          </div>
        )}
      </div>
    </div>
  );
}
