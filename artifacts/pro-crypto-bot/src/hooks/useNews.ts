/**
 * useNews — News feed hook with live CryptoPanic polling + sentiment analysis
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  NewsItem, NewsFilter, NewsFeed, SentimentBreakdown,
  fetchCryptoPanicNews, generateMockNews, filterNews,
  computeSentimentBreakdown, coinSentimentScore,
} from "../services/news";

const POLL_INTERVAL = 90_000;   // 90s — news API rate limit friendly
// const MOCK_INTERVAL = 30_000;   // 30s mock refresh (reserved)

export interface UseNewsReturn {
  feed:             NewsFeed;
  filtered:         NewsItem[];
  sentiment:        SentimentBreakdown;
  coinSentiments:   Record<string, number>;
  filter:           NewsFilter;
  setFilter:        (f: Partial<NewsFilter>) => void;
  isLoading:        boolean;
  isMock:           boolean;
  refresh:          () => void;
}

const DEFAULT_FILTER: NewsFilter = {
  coins:     [],
  sentiment: "all",
  impact:    "all",
  sources:   [],
  maxAge:    24,
  minImpact: 1,
};

const KNOWN_COINS = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "AVAX", "DOGE"];

export function useNews(): UseNewsReturn {
  const [feed,      setFeed]      = useState<NewsFeed>({
    items: [], lastFetch: new Date(), isLive: false, totalCount: 0, sentimentScore: 0,
  });
  const [filter,    setFilterState] = useState<NewsFilter>(DEFAULT_FILTER);
  const [isLoading, setIsLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchNews = useCallback(async () => {
    setIsLoading(true);
    try {
      const live = await fetchCryptoPanicNews();
      if (live.length > 0) {
        const breakdown = computeSentimentBreakdown(live);
        setFeed({
          items:          live,
          lastFetch:      new Date(),
          isLive:         true,
          totalCount:     live.length,
          sentimentScore: breakdown.score,
        });
        setIsLoading(false);
        return;
      }
    } catch { /* fall through */ }

    // Fallback to mock
    const mock      = generateMockNews();
    const breakdown = computeSentimentBreakdown(mock);
    setFeed({
      items:          mock,
      lastFetch:      new Date(),
      isLive:         false,
      totalCount:     mock.length,
      sentimentScore: breakdown.score,
    });
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchNews();
    intervalRef.current = setInterval(fetchNews, POLL_INTERVAL);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchNews]);

  const setFilter = useCallback((partial: Partial<NewsFilter>) => {
    setFilterState((prev) => ({ ...prev, ...partial }));
  }, []);

  const filtered = filterNews(feed.items, filter);
  const sentiment = computeSentimentBreakdown(filtered.length > 0 ? filtered : feed.items);

  const coinSentiments: Record<string, number> = {};
  KNOWN_COINS.forEach((coin) => {
    coinSentiments[coin] = coinSentimentScore(feed.items, coin);
  });

  return {
    feed, filtered, sentiment, coinSentiments,
    filter, setFilter, isLoading,
    isMock: !feed.isLive,
    refresh: fetchNews,
  };
}
