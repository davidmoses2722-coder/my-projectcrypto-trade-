/**
 * News Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Fetches crypto news from CryptoPanic public API (no key needed for basic)
 * Falls back to curated mock news with realistic sentiment scoring.
 *
 * Includes:
 *  - Sentiment analysis (positive / negative / neutral)
 *  - Impact scoring (1–10)
 *  - Coin tagging (BTC, ETH, SOL, etc.)
 *  - Source credibility scoring
 *  - Filter engine: by coin, sentiment, impact, source
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type NewsSentiment = "positive" | "negative" | "neutral";
export type NewsImpact    = "high" | "medium" | "low";
export type NewsSource    = "CryptoPanic" | "CoinDesk" | "Cointelegraph" | "Bloomberg" | "Reuters" | "Twitter" | "Reddit" | "Other";

export interface NewsItem {
  id:          string;
  title:       string;
  url:         string;
  source:      NewsSource;
  sentiment:   NewsSentiment;
  impact:      NewsImpact;
  impactScore: number;   // 1–10
  coins:       string[]; // ["BTC", "ETH", ...]
  publishedAt: Date;
  summary:     string;
  credibility: number;   // 0–100
  votes: {
    positive: number;
    negative: number;
    important: number;
    saved:     number;
  };
  isBreaking: boolean;
  priceEffect: "pump" | "dump" | "neutral";
}

export interface NewsFilter {
  coins:      string[];          // empty = all
  sentiment:  NewsSentiment | "all";
  impact:     NewsImpact    | "all";
  sources:    NewsSource[];
  maxAge:     number;            // hours, 0 = no limit
  minImpact:  number;            // 1–10
}

export interface NewsFeed {
  items:          NewsItem[];
  lastFetch:      Date;
  isLive:         boolean;
  totalCount:     number;
  sentimentScore: number;   // -100 to +100, overall market sentiment
}

export interface SentimentBreakdown {
  positive: number;
  negative: number;
  neutral:  number;
  score:    number;   // -100 to +100
  trend:    "improving" | "deteriorating" | "stable";
}

// ─── CryptoPanic API ──────────────────────────────────────────────────────────

const CRYPTOPANIC_BASE = "https://cryptopanic.com/api/v1/posts/";

interface CryptoPanicPost {
  id:           number;
  title:        string;
  url:          string;
  source:       { title: string; domain: string; region: string };
  currencies?:  { code: string; title: string }[];
  published_at: string;
  votes:        { positive: number; negative: number; important: number; saved: number; comments: number };
  kind:         "news" | "media" | "analysis";
}

interface CryptoPanicResponse {
  results: CryptoPanicPost[];
  count:   number;
}

// ─── Sentiment Keywords ───────────────────────────────────────────────────────

const POSITIVE_WORDS = [
  "surge", "soar", "rally", "bull", "bullish", "breakout", "pump", "moon",
  "ath", "all-time high", "adoption", "launch", "partnership", "upgrade",
  "approval", "etf", "institutional", "record", "growth", "gains", "recovery",
  "outperform", "strong", "buy", "accumulate", "support",
];

const NEGATIVE_WORDS = [
  "crash", "dump", "bear", "bearish", "collapse", "plunge", "hack", "exploit",
  "fraud", "ban", "regulate", "sec", "lawsuit", "scam", "rug", "liquidation",
  "fear", "panic", "sell", "correction", "resistance", "warning", "risk",
  "concern", "drop", "fall", "decline", "down",
];

const HIGH_IMPACT_WORDS = [
  "etf", "sec", "federal reserve", "fed", "regulation", "ban", "hack",
  "billion", "institutional", "government", "congress", "lawsuit", "ath",
  "halving", "fork", "exploit", "emergency",
];

// ─── Scoring Helpers ──────────────────────────────────────────────────────────

function scoreSentiment(title: string): { sentiment: NewsSentiment; score: number } {
  const lower = title.toLowerCase();
  let posScore = 0;
  let negScore = 0;

  POSITIVE_WORDS.forEach((w) => { if (lower.includes(w)) posScore++; });
  NEGATIVE_WORDS.forEach((w) => { if (lower.includes(w)) negScore++; });

  if (posScore > negScore) return { sentiment: "positive", score: Math.min(10, posScore * 2) };
  if (negScore > posScore) return { sentiment: "negative", score: Math.min(10, negScore * 2) };
  return { sentiment: "neutral", score: 3 };
}

function scoreImpact(title: string, votes: CryptoPanicPost["votes"]): { impact: NewsImpact; score: number } {
  const lower = title.toLowerCase();
  let score = 3;

  HIGH_IMPACT_WORDS.forEach((w) => { if (lower.includes(w)) score += 2; });
  score += Math.min(3, Math.floor((votes.important + votes.positive) / 10));

  const clamped = Math.min(10, score);
  const impact: NewsImpact = clamped >= 7 ? "high" : clamped >= 4 ? "medium" : "low";
  return { impact, score: clamped };
}

function extractCoins(currencies?: { code: string }[]): string[] {
  const known = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "AVAX", "DOGE"];
  if (!currencies || currencies.length === 0) return [];
  return currencies.map((c) => c.code.toUpperCase()).filter((c) => known.includes(c));
}

function sourceCredibility(domain: string): number {
  const scores: Record<string, number> = {
    "bloomberg.com": 95, "reuters.com": 95, "wsj.com": 90,
    "coindesk.com": 85,  "cointelegraph.com": 80, "decrypt.co": 78,
    "theblock.co": 82,   "cryptopanic.com": 65,   "twitter.com": 50,
    "reddit.com": 40,
  };
  for (const [key, val] of Object.entries(scores)) {
    if (domain.includes(key)) return val;
  }
  return 60;
}

function mapSource(domain: string): NewsSource {
  if (domain.includes("coindesk"))       return "CoinDesk";
  if (domain.includes("cointelegraph"))  return "Cointelegraph";
  if (domain.includes("bloomberg"))      return "Bloomberg";
  if (domain.includes("reuters"))        return "Reuters";
  if (domain.includes("twitter") || domain.includes("x.com")) return "Twitter";
  if (domain.includes("reddit"))         return "Reddit";
  return "Other";
}

function parseCryptoPanicPost(post: CryptoPanicPost): NewsItem {
  const { sentiment } = scoreSentiment(post.title);
  const { impact, score: impScore }     = scoreImpact(post.title, post.votes);
  const coins                           = extractCoins(post.currencies);
  const domain                          = post.source.domain;

  return {
    id:          String(post.id),
    title:       post.title,
    url:         post.url,
    source:      mapSource(domain),
    sentiment,
    impact,
    impactScore: impScore,
    coins,
    publishedAt: new Date(post.published_at),
    summary:     post.title,
    credibility: sourceCredibility(domain),
    votes: {
      positive:  post.votes.positive,
      negative:  post.votes.negative,
      important: post.votes.important,
      saved:     post.votes.saved,
    },
    isBreaking:  impScore >= 8,
    priceEffect: sentiment === "positive" ? "pump" : sentiment === "negative" ? "dump" : "neutral",
  };
}

// ─── Live Fetch ───────────────────────────────────────────────────────────────

export async function fetchCryptoPanicNews(): Promise<NewsItem[]> {
  try {
    const url = `${CRYPTOPANIC_BASE}?public=true&kind=news&regions=en`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: CryptoPanicResponse = await res.json();
    return data.results.slice(0, 30).map(parseCryptoPanicPost);
  } catch {
    return []; // caller handles fallback
  }
}

// ─── Mock News ────────────────────────────────────────────────────────────────

const MOCK_TEMPLATES = [
  { title: "Bitcoin ETF sees record $1.2B inflows as institutional demand surges", coins: ["BTC"], sentiment: "positive" as NewsSentiment, impact: "high" as NewsImpact, impactScore: 9, source: "Bloomberg" as NewsSource, priceEffect: "pump" as const },
  { title: "Ethereum upgrade reduces gas fees by 40%, developers celebrate", coins: ["ETH"], sentiment: "positive" as NewsSentiment, impact: "high" as NewsImpact, impactScore: 8, source: "CoinDesk" as NewsSource, priceEffect: "pump" as const },
  { title: "Solana network experiences brief outage, validators working on fix", coins: ["SOL"], sentiment: "negative" as NewsSentiment, impact: "medium" as NewsImpact, impactScore: 6, source: "Cointelegraph" as NewsSource, priceEffect: "dump" as const },
  { title: "SEC delays decision on spot ETH ETF, market reacts cautiously", coins: ["ETH"], sentiment: "negative" as NewsSentiment, impact: "high" as NewsImpact, impactScore: 8, source: "Reuters" as NewsSource, priceEffect: "dump" as const },
  { title: "Binance launches new BNB staking program with 12% APY", coins: ["BNB"], sentiment: "positive" as NewsSentiment, impact: "medium" as NewsImpact, impactScore: 5, source: "CoinDesk" as NewsSource, priceEffect: "pump" as const },
  { title: "XRP court ruling in favor of Ripple sparks 25% rally", coins: ["XRP"], sentiment: "positive" as NewsSentiment, impact: "high" as NewsImpact, impactScore: 10, source: "Bloomberg" as NewsSource, priceEffect: "pump" as const },
  { title: "Cardano smart contract adoption grows 300% in Q1 2025", coins: ["ADA"], sentiment: "positive" as NewsSentiment, impact: "medium" as NewsImpact, impactScore: 6, source: "Cointelegraph" as NewsSource, priceEffect: "pump" as const },
  { title: "Federal Reserve signals rate cut — crypto markets surge in response", coins: ["BTC", "ETH"], sentiment: "positive" as NewsSentiment, impact: "high" as NewsImpact, impactScore: 9, source: "Reuters" as NewsSource, priceEffect: "pump" as const },
  { title: "Major exchange suffers $500M hack — withdrawals suspended", coins: ["BTC", "ETH", "SOL"], sentiment: "negative" as NewsSentiment, impact: "high" as NewsImpact, impactScore: 10, source: "Bloomberg" as NewsSource, priceEffect: "dump" as const },
  { title: "DOGE whale moves 2B tokens to cold storage, community bullish", coins: ["DOGE"], sentiment: "positive" as NewsSentiment, impact: "medium" as NewsImpact, impactScore: 5, source: "Other" as NewsSource, priceEffect: "pump" as const },
  { title: "Avalanche partners with major Asian bank for tokenized assets", coins: ["AVAX"], sentiment: "positive" as NewsSentiment, impact: "medium" as NewsImpact, impactScore: 7, source: "CoinDesk" as NewsSource, priceEffect: "pump" as const },
  { title: "BTC mining difficulty hits all-time high amid miner capitulation fears", coins: ["BTC"], sentiment: "neutral" as NewsSentiment, impact: "medium" as NewsImpact, impactScore: 5, source: "Cointelegraph" as NewsSource, priceEffect: "neutral" as const },
  { title: "Crypto markets consolidate as traders await FOMC decision", coins: ["BTC", "ETH"], sentiment: "neutral" as NewsSentiment, impact: "low" as NewsImpact, impactScore: 3, source: "Other" as NewsSource, priceEffect: "neutral" as const },
  { title: "Solana DeFi TVL reaches new peak at $12B amid ecosystem growth", coins: ["SOL"], sentiment: "positive" as NewsSentiment, impact: "medium" as NewsImpact, impactScore: 7, source: "CoinDesk" as NewsSource, priceEffect: "pump" as const },
  { title: "China reiterates crypto mining ban enforcement — market dips", coins: ["BTC"], sentiment: "negative" as NewsSentiment, impact: "high" as NewsImpact, impactScore: 8, source: "Reuters" as NewsSource, priceEffect: "dump" as const },
  { title: "MicroStrategy adds another 10,000 BTC to corporate treasury", coins: ["BTC"], sentiment: "positive" as NewsSentiment, impact: "high" as NewsImpact, impactScore: 8, source: "Bloomberg" as NewsSource, priceEffect: "pump" as const },
  { title: "Ethereum staking yield drops to 3.2% as more validators join", coins: ["ETH"], sentiment: "neutral" as NewsSentiment, impact: "low" as NewsImpact, impactScore: 3, source: "Cointelegraph" as NewsSource, priceEffect: "neutral" as const },
  { title: "Ripple expands payment corridors to 20 new countries via ODL", coins: ["XRP"], sentiment: "positive" as NewsSentiment, impact: "medium" as NewsImpact, impactScore: 6, source: "CoinDesk" as NewsSource, priceEffect: "pump" as const },
  { title: "DeFi protocol suffers flash loan attack — $80M drained", coins: ["ETH", "ADA"], sentiment: "negative" as NewsSentiment, impact: "high" as NewsImpact, impactScore: 9, source: "Cointelegraph" as NewsSource, priceEffect: "dump" as const },
  { title: "Global crypto adoption hits 500M users milestone, Chainalysis reports", coins: ["BTC", "ETH"], sentiment: "positive" as NewsSentiment, impact: "medium" as NewsImpact, impactScore: 7, source: "Bloomberg" as NewsSource, priceEffect: "pump" as const },
];

let _mockOffset = 0;

export function generateMockNews(): NewsItem[] {
  const now = Date.now();
  return MOCK_TEMPLATES.map((t, i) => ({
    id:          `mock-${i}-${_mockOffset}`,
    title:       t.title,
    url:         "#",
    source:      t.source,
    sentiment:   t.sentiment,
    impact:      t.impact,
    impactScore: t.impactScore,
    coins:       t.coins,
    publishedAt: new Date(now - (i * 18 + _mockOffset) * 60_000),
    summary:     t.title,
    credibility: sourceCredibility(t.source.toLowerCase() + ".com"),
    votes: {
      positive:  Math.floor(Math.random() * 200),
      negative:  Math.floor(Math.random() * 80),
      important: Math.floor(Math.random() * 150),
      saved:     Math.floor(Math.random() * 100),
    },
    isBreaking:  t.impactScore >= 9,
    priceEffect: t.priceEffect,
  }));
}

// ─── Filter Engine ────────────────────────────────────────────────────────────

export function filterNews(items: NewsItem[], filter: NewsFilter): NewsItem[] {
  return items.filter((item) => {
    if (filter.coins.length > 0 && !item.coins.some((c) => filter.coins.includes(c))) return false;
    if (filter.sentiment !== "all" && item.sentiment !== filter.sentiment) return false;
    if (filter.impact    !== "all" && item.impact    !== filter.impact)    return false;
    if (filter.minImpact > 1 && item.impactScore < filter.minImpact)       return false;
    if (filter.maxAge > 0) {
      const ageH = (Date.now() - item.publishedAt.getTime()) / 3_600_000;
      if (ageH > filter.maxAge) return false;
    }
    if (filter.sources.length > 0 && !filter.sources.includes(item.source)) return false;
    return true;
  });
}

// ─── Sentiment Aggregation ────────────────────────────────────────────────────

export function computeSentimentBreakdown(items: NewsItem[]): SentimentBreakdown {
  if (items.length === 0) return { positive: 0, negative: 0, neutral: 100, score: 0, trend: "stable" };

  const pos = items.filter((i) => i.sentiment === "positive").length;
  const neg = items.filter((i) => i.sentiment === "negative").length;
  const _neu = items.filter((i) => i.sentiment === "neutral").length; void _neu;
  const total = items.length;

  const posPct = Math.round((pos / total) * 100);
  const negPct = Math.round((neg / total) * 100);
  const neuPct = 100 - posPct - negPct;

  // Weighted score: high-impact news counts more
  let weightedScore = 0;
  let totalWeight   = 0;
  items.forEach((item) => {
    const w = item.impactScore;
    const s = item.sentiment === "positive" ? 1 : item.sentiment === "negative" ? -1 : 0;
    weightedScore += s * w;
    totalWeight   += w;
  });

  const score = totalWeight > 0 ? Math.round((weightedScore / totalWeight) * 100) : 0;

  const trend: SentimentBreakdown["trend"] =
    score >= 20  ? "improving" :
    score <= -20 ? "deteriorating" : "stable";

  return { positive: posPct, negative: negPct, neutral: neuPct, score, trend };
}

// ─── Coin-specific sentiment ──────────────────────────────────────────────────

export function coinSentimentScore(items: NewsItem[], coin: string): number {
  const coinNews = items.filter((i) => i.coins.includes(coin));
  if (coinNews.length === 0) return 0;

  let score = 0;
  let total = 0;
  coinNews.forEach((n) => {
    const w = n.impactScore;
    const s = n.sentiment === "positive" ? 1 : n.sentiment === "negative" ? -1 : 0;
    score += s * w;
    total += w;
  });
  return total > 0 ? Math.round((score / total) * 100) : 0;
}
