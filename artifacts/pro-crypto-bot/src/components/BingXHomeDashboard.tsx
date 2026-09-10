import { useState, useEffect, useMemo, useCallback } from "react";
import { Search, Bell, Gift, Headphones, TrendingUp, TrendingDown, ChevronRight, Flame, Hash, ArrowRight } from "lucide-react";
import { useTradFiPrices } from "../hooks/useTradFiPrices";
import { useLivePrices } from "../hooks/useLivePrices";

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtPrice(price: number): string {
  if (price >= 1000) return price.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (price >= 1) return price.toFixed(2);
  return price.toFixed(4);
}

function PriceBadge({ change }: { change: number }) {
  const isUp = change >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-bold ${isUp ? "text-emerald-400" : "text-rose-400"}`}>
      {isUp ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
      {Math.abs(change).toFixed(2)}%
    </span>
  );
}

/** Generate a 7-day sparkline path from a price array (15 points, 1 per 4h) */
function sparklinePath(points: number[]): string {
  if (!points || points.length < 2) return "M0 12 Q16 12 32 12 Q48 12 64 12";
  const w = 64, h = 24;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const pts = points.map((v, i) => {
    const x = (i / (points.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  // Smooth quadratic curve through points
  let d = `M${pts[0]}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1].split(",").map(Number);
    const curr = pts[i].split(",").map(Number);
    const cpx = (prev[0] + curr[0]) / 2;
    d += ` Q${cpx.toFixed(1)},${prev[1].toFixed(1)} ${curr[0].toFixed(1)},${curr[1].toFixed(1)}`;
  }
  return d;
}

function Sparkline({ points, change24h }: { points?: number[] | number[]; change24h: number }) {
  const isUp = change24h >= 0;
  const color = isUp ? "#10b981" : "#ef4444";
  const d = sparklinePath(points ?? []);
  return (
    <svg viewBox="0 0 64 24" className="w-full h-full" preserveAspectRatio="none" style={{ width: 64, height: 24 }}>
      <defs>
        <linearGradient id={`spark-${isUp ? "up" : "down"}-${Math.random().toString(36).slice(2,6)}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor={color} stopOpacity={0.25} />
          <stop offset="95%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d={`M0 24 ${d.match(/M[^Z]+/)?.[0] || "L0,24"} L64 24 Z`} fill={`url(#spark-${isUp ? "up" : "down"}-${Math.random().toString(36).slice(2,6)})`} opacity={0.15} />
    </svg>
  );
}

// ── Icons ───────────────────────────────────────────────────────────────────────
function HomeIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}
function MarketsIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" />
    </svg>
  );
}
function TradeIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 3h5v5" /><path d="M4 20 21 3" /><path d="M21 16v5h-5" /><path d="M15 15l6 6" /><path d="M4 8l6 6" />
    </svg>
  );
}
function TradFiIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="8" width="20" height="12" rx="2" /><path d="M6 12h4" /><path d="M2 12h2" />
    </svg>
  );
}
function AssetsIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" /><path d="M2 10h20" />
    </svg>
  );
}
function ExchangeIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 0 1 0 4H8" /><path d="M12 18V6" />
    </svg>
  );
}

// ── Data catalogs ──────────────────────────────────────────────────────────────
/** Crypto pairs for "Hot" tab */
const CRYPTO_ASSETS = [
  { id: "btc", base: "BTC", name: "Bitcoin", category: "crypto" as const },
  { id: "eth", base: "ETH", name: "Ethereum", category: "crypto" as const },
  { id: "sol", base: "SOL", name: "Solana", category: "crypto" as const },
  { id: "bnb", base: "BNB", name: "BNB", category: "crypto" as const },
  { id: "xrp", base: "XRP", name: "XRP", category: "crypto" as const },
  { id: "ada", base: "ADA", name: "Cardano", category: "crypto" as const },
  { id: "doge", base: "DOGE", name: "Dogecoin", category: "crypto" as const },
  { id: "link", base: "LINK", name: "Chainlink", category: "crypto" as const },
  { id: "dot", base: "DOT", name: "Polkadot", category: "crypto" as const },
  { id: "avax", base: "AVAX", name: "Avalanche", category: "crypto" as const },
  { id: "matic", base: "MATIC", name: "Polygon", category: "crypto" as const },
  { id: "atom", base: "ATOM", name: "Cosmos", category: "crypto" as const },
  { id: "near", base: "NEAR", name: "NEAR Protocol", category: "crypto" as const },
  { id: "op", base: "OP", name: "Optimism", category: "crypto" as const },
  { id: "arb", base: "ARB", name: "Arbitrum", category: "crypto" as const },
  { id: "matic", base: "POL", name: "POL (ex-MATIC)", category: "crypto" as const },
];

/** US Stocks for "Stocks" tab */
const STOCK_ASSETS = [
  { id: "tsla", base: "TSLA", name: "Tesla Inc.", category: "stock" as const, isKorean: false },
  { id: "aapl", base: "AAPL", name: "Apple Inc.", category: "stock" as const, isKorean: false },
  { id: "amzn", base: "AMZN", name: "Amazon.com", category: "stock" as const, isKorean: false },
  { id: "googl", base: "GOOGL", name: "Alphabet Inc.", category: "stock" as const, isKorean: false },
  { id: "msft", base: "MSFT", name: "Microsoft Corp.", category: "stock" as const, isKorean: false },
  { id: "nvda", base: "NVDA", name: "NVIDIA Corp.", category: "stock" as const, isKorean: false },
  { id: "meta", base: "META", name: "Meta Platforms", category: "stock" as const, isKorean: false },
  { id: "nflx", base: "NFLX", name: "Netflix Inc.", category: "stock" as const, isKorean: false },
  { id: "TSLA", base: "TSLA", name: "Tesla Inc.", category: "stock" as const, isKorean: false },
  { id: "AAPL", base: "AAPL", name: "Apple Inc.", category: "stock" as const, isKorean: false },
  { id: "SPCX", base: "SPCX", name: "SPDR S&P 500 ETF", category: "stock" as const, isKorean: false },
  { id: "SOXL", base: "SOXL", name: "SOXL (Semi Bull)", category: "stock" as const, isKorean: false },
  { id: "MSTR", base: "MSTR", name: "MicroStrategy", category: "stock" as const, isKorean: false },
  { id: "ASML", base: "ASML", name: "ASML Holding", category: "stock" as const, isKorean: false },
];

/** Korean stocks for "Korean Stocks" sub-pill */
const KOREAN_ASSETS = [
  { id: "005930", base: "005930", name: "Samsung Electronics", category: "kstock" as const },
  { id: "035420", base: "035420", name: "NAVER Corp.", category: "kstock" as const },
  { id: "051910", base: "051910", name: "LG Chem", category: "kstock" as const },
  { id: "000660", base: "000660", name: "SK hynix", category: "kstock" as const },
  { id: "035720", base: "035720", name: "Kakao Corp.", category: "kstock" as const },
  { id: "006400", base: "006400", name: "Samsung SDI", category: "kstock" as const },
  { id: "052030", base: "052030", name: "Korea Magnesium", category: "kstock" as const },
];

/** TradFi assets for "TradFi" tab (GOLD, OIL, Indices, FX) */
const TRADFI_ASSETS = [
  { id: "gold", base: "GOLD", name: "Gold Spot (XAU/USD)", category: "tradfi" as const, color: "#d4af37" },
  { id: "oil", base: "OIL", name: "Brent Crude", category: "tradfi" as const, color: "#3b82f6" },
  { id: "nasdaq100", base: "NDX", name: "NASDAQ 100 Index", category: "tradfi" as const, color: "#10b981" },
  { id: "spx", base: "SPX", name: "S&P 500 Index", category: "tradfi" as const, color: "#8b5cf6" },
  { id: "ftse", base: "UKX", name: "FTSE 100", category: "tradfi" as const, color: "#f59e0b" },
  { id: "dxy", base: "DXY", name: "US Dollar Index", category: "tradfi" as const, color: "#06b6d4" },
  { id: "eurusd", base: "EUR/USD", name: "EUR/USD", category: "tradfi" as const, color: "#ec4899" },
  { id: "us10y", base: "US10Y", name: "US 10Y Treasury", category: "tradfi" as const, color: "#14b8a6" },
  { id: "nky", base: "NKY", name: "Nikkei 225", category: "tradfi" as const, color: "#f97316" },
  { id: "sth", base: "STH", name: "Shanghai Composite", category: "tradfi" as const, color: "#a855f7" },
];

// ── Favorites (localStorage) ────────────────────────────────────────────────────
function useFavorites() {
  const [favorites, setFavorites] = useState<string[]>([]);
  useEffect(() => {
    try {
      const stored = localStorage.getItem("bingx_favorites");
      if (stored) setFavorites(JSON.parse(stored) as string[]);
    } catch { /* ignore */ }
  }, []);
  const toggleFavorite = useCallback((symbol: string) => {
    setFavorites(prev => {
      const next = prev.includes(symbol)
        ? prev.filter(s => s !== symbol)
        : [...prev, symbol];
      try { localStorage.setItem("bingx_favorites", JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);
  return { favorites, toggleFavorite };
}

// ── Bottom Nav with routing ─────────────────────────────────────────────────────
const BOTTOM_TABS = [
  { id: "home",   label: "Home",   icon: HomeIcon,  active: true },
  { id: "markets", label: "Markets", icon: MarketsIcon },
  { id: "trade",   label: "Trade",   icon: TradeIcon },
  { id: "tradfi",  label: "TradFi",  icon: TradFiIcon },
  { id: "assets",  label: "Assets",  icon: AssetsIcon },
];

interface BottomNavProps {
  onTabChange: (tabId: string) => void;
  activeTab?: string;
}

function BottomNav({ onTabChange, activeTab = "home" }: BottomNavProps) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-[#0b0e11] border-t border-[#1e2329]">
      <div className="flex items-center justify-around py-2 pb-2 safe-area-bottom">
        {BOTTOM_TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex flex-col items-center gap-0.5 transition-colors relative ${
                isActive ? "text-white" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {isActive && (
                <span className="absolute -top-0.5 w-8 h-1 rounded-full bg-[#2b6be8] shadow-[0_0_8px_rgba(43,107,232,0.6)]" />
              )}
              <span className={isActive ? "drop-shadow-[0_0_6px_rgba(43,107,232,0.5)]" : ""}>
                <Icon size={22} />
              </span>
              <span className={`text-[10px] font-bold tracking-wider ${isActive ? "text-[#2b6be8]" : ""}`}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
      <div className="h-1 bg-[#1e2329]" />
    </nav>
  );
}

// ── Top Header ─────────────────────────────────────────────────────────────────
function TopHeader() {
  return (
    <header className="bg-[#0b0e11] sticky top-0 z-40 border-b border-[#1e2329]">
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Profile avatar */}
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#2b6be8] to-[#6366f1] flex items-center justify-center text-white font-bold text-sm shrink-0 shadow-md">
          J
        </div>
        {/* Search bar */}
        <div className="flex-1 relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search BTC, ETH..."
            defaultValue="BTC/USDT"
            className="w-full bg-[#181a20] rounded-xl py-2 pl-9 pr-4 text-sm text-slate-300 placeholder-slate-600 border border-[#2a2f3a] focus:outline-none focus:border-[#2b6be8] transition-colors"
          />
        </div>
        {/* Action icons */}
        <button className="w-9 h-9 rounded-xl bg-[#181a20] flex items-center justify-center text-slate-400 hover:text-white hover:bg-[#22262f] border border-[#2a2f3a] transition-all">
          <Headphones size={18} />
        </button>
        <button className="w-9 h-9 rounded-xl bg-[#181a20] flex items-center justify-center text-slate-400 hover:text-white hover:bg-[#22262f] border border-[#2a2f3a] transition-all relative">
          <Gift size={18} />
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-[#f59e0b] text-[9px] font-bold text-white flex items-center justify-center shadow-md">3</span>
        </button>
        <button className="w-9 h-9 rounded-xl bg-[#181a20] flex items-center justify-center text-slate-400 hover:text-white hover:bg-[#22262f] border border-[#2a2f3a] transition-all relative">
          <Bell size={18} />
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-rose-500 text-[9px] font-bold text-white flex items-center justify-center shadow-md">5</span>
        </button>
      </div>
    </header>
  );
}

// ── Promo Banner ───────────────────────────────────────────────────────────────
function PromoBanner({ onCTAClick }: { onCTAClick?: () => void }) {
  return (
    <div className="bg-gradient-to-r from-[#1e3a8a] to-[#2b6be8] rounded-2xl p-4 mb-4 flex items-center justify-between text-white shadow-lg shadow-blue-500/10 border border-blue-400/20">
      <div>
        <p className="text-[13px] font-bold text-blue-200 uppercase tracking-wider mb-0.5">Limited Offer</p>
        <p className="text-white font-black text-base leading-tight">Get 50 USDT welcome bonus</p>
        <p className="text-blue-200 text-xs mt-1">Deposit now and start trading</p>
      </div>
      <button
        onClick={onCTAClick}
        className="bg-white text-[#2b6be8] font-bold px-5 py-2.5 rounded-xl text-sm hover:bg-blue-50 transition-colors shadow-lg shrink-0"
      >
        Trade Now
      </button>
    </div>
  );
}

// ── Quick Actions Row ──────────────────────────────────────────────────────────
const QUICK_ACTIONS = [
  { id: "p2p",  label: "P2P Trading", icon: ExchangeIcon, badge: "Hot", badgeColor: "bg-emerald-500" },
  { id: "rewards", label: "Rewards Hub", icon: Gift, badge: "New", badgeColor: "bg-amber-500" },
  { id: "superx", label: "SuperX", icon: Flame, badge: "HOT", badgeColor: "bg-rose-500" },
  { id: "copy",  label: "Copy Trading", icon: Flame, badge: "", badgeColor: "" },
  { id: "referral", label: "Referral", icon: TrendingUp, badge: "", badgeColor: "" },
];

function QuickActionsRow() {
  return (
    <div className="mb-5">
      <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 -mx-1 px-1">
        {QUICK_ACTIONS.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.id}
              className="flex-shrink-0 w-[100px] bg-[#121418] rounded-2xl p-3 border border-[#1e2329] hover:border-[#2b6be8]/40 transition-all flex flex-col items-center gap-2 group"
            >
              <div className="w-12 h-12 rounded-xl bg-[#1a1d24] flex items-center justify-center text-slate-300 group-hover:bg-[#2b6be8]/10 group-hover:text-[#2b6be8] transition-all">
                <Icon size={24} />
              </div>
              <span className="text-[13px] font-bold text-slate-300 text-center leading-tight">{item.label}</span>
              {item.badge && (
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${item.badgeColor} text-white`}>
                  {item.badge}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Hot Tickers Grid (2x2) ────────────────────────────────────────────────────
function HotTickerCards({ cryptoPrices, tradfiPrices }: { cryptoPrices: ReturnType<typeof useLivePrices>["prices"]; tradfiPrices: ReturnType<typeof useTradFiPrices>["prices"] }) {
  // Merge: use live crypto prices + tradfi prices for GOLD/OIL
  const btc = cryptoPrices.find(p => p.symbol === "BTC");
  const eth = cryptoPrices.find(p => p.symbol === "ETH");
  const gold = tradfiPrices.find(p => p.symbol === "GOLD" || p.symbol === "XAU");
  const oil = tradfiPrices.find(p => p.symbol === "OIL");

  const hot = [
    { id: "btc", base: "BTC", name: "Bitcoin", price: btc?.price ?? 0, change24h: btc?.changePercent24h ?? 0, color: "#f7931a", headline: "Market momentum building" },
    { id: "eth", base: "ETH", name: "Ethereum", price: eth?.price ?? 0, change24h: eth?.changePercent24h ?? 0, color: "#627eea", headline: "ETF inflow steady" },
    { id: "gold", base: "GOLD", name: "Gold Spot (XAU/USD)", price: gold?.price ?? 2648.3, change24h: gold?.changePercent24h ?? 0.78, color: "#d4af37", headline: "Safe-haven demand up" },
    { id: "oil", base: "OIL", name: "Brent Crude", price: oil?.price ?? 82.45, change24h: oil?.changePercent24h ?? -0.53, color: "#3b82f6", headline: "Supply concerns persist" },
  ];

  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-3 px-1">
        <h2 className="text-white font-black text-base">Hot</h2>
        <button className="text-[#2b6be8] text-xs font-bold hover:underline">View All</button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {hot.map((ticker) => {
          const isUp = ticker.change24h >= 0;
          return (
            <div key={ticker.id} className="bg-[#121418] rounded-2xl p-3 border border-[#1e2329] hover:border-slate-700 transition-all">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-black text-white" style={{ backgroundColor: ticker.color }}>
                  {ticker.base.slice(0, 2)}
                </div>
                <div>
                  <p className="text-white text-sm font-bold">{ticker.base}</p>
                  <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">{ticker.name}</p>
                </div>
              </div>
              <p className="text-white font-black text-lg mb-1">${fmtPrice(ticker.price)}</p>
              <div className="flex items-center gap-1.5 mb-1.5">
                {isUp ? <TrendingUp size={12} className="text-emerald-400" /> : <TrendingDown size={12} className="text-rose-400" />}
                <span className={`text-xs font-bold ${isUp ? "text-emerald-400" : "text-rose-400"}`}>
                  {isUp ? "+" : ""}{ticker.change24h.toFixed(2)}%
                </span>
              </div>
              <p className="text-slate-500 text-[11px] font-medium leading-tight">{ticker.headline}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Category Tab Filtering ─────────────────────────────────────────────────────
const MAIN_TABS = ["Favorites", "Hot", "Stocks", "TradFi", "Gainers", "New"];
const SUBCATEGORIES = ["Trending", "US Stocks", "Korean Stocks", "Indices"];

type ActiveCategory = "all" | "crypto" | "stock" | "kstock" | "tradfi" | "favorites";
type ActiveSub = "trending" | "us_stocks" | "korean_stocks" | "indices";

function categoryForTab(tab: string): ActiveCategory {
  if (tab === "Favorites") return "favorites";
  if (tab === "Hot") return "all";
  if (tab === "Stocks") return "stock";
  if (tab === "TradFi") return "tradfi";
  if (tab === "Gainers") return "all"; // highest gainers
  if (tab === "New") return "all"; // newest
  return "all";
}

function subFilterForPill(pill: string): ActiveSub {
  if (pill === "US Stocks") return "us_stocks";
  if (pill === "Korean Stocks") return "korean_stocks";
  if (pill === "Indices") return "indices";
  return "trending";
}

interface MarketTabListProps {
  cryptoPrices: ReturnType<typeof useLivePrices>["prices"];
  tradfiPrices: ReturnType<typeof useTradFiPrices>["prices"];
}

function MarketTabList({ cryptoPrices, tradfiPrices }: MarketTabListProps) {
  const [activeMainTab, setActiveMainTab] = useState("Favorites");
  const [activeSubPill, setActiveSubPill] = useState("Trending");
  const { favorites, toggleFavorite } = useFavorites();

  const activeCategory = categoryForTab(activeMainTab);
  const activeSub = subFilterForPill(activeSubPill);

  // Build the unified asset list based on selected category + sub-filter
  const displayedAssets = useMemo(() => {
    let assets: Array<{
      id: string; base: string; name: string;
      price: number; change24h: number; changePercent24h: number;
      category: "crypto" | "stock" | "kstock" | "tradfi";
      color?: string; sparkline?: number[];
    }> = [];

    if (activeCategory === "favorites") {
      // Favorites: merge crypto + stock + tradfi by symbol
      const favSet = new Set(favorites);
      if (favSet.size === 0) {
        // Default favorites if none saved
        return [
          ...CRYPTO_ASSETS.slice(0, 4).map(a => ({ ...a, price: 0, change24h: 0, changePercent24h: 0, sparkline: [], color: undefined })),
          ...STOCK_ASSETS.slice(0, 2).map(a => ({ ...a, price: 0, change24h: 0, changePercent24h: 0, sparkline: [], color: undefined })),
        ];
      }
      for (const sym of favSet) {
        const upper = sym.toUpperCase();
        let match: typeof assets[0] | null = null;
        // Check crypto
        const cp = cryptoPrices.find(p => p.symbol === upper);
        if (cp) {
          match = { id: cp.id, base: cp.symbol, name: cp.name, price: cp.price, change24h: cp.change24h, changePercent24h: cp.changePercent24h, category: "crypto" as const, sparkline: cp.sparkline ?? [], color: undefined };
        } else {
          // Check stocks
          const st = STOCK_ASSETS.find(a => a.base === upper || a.id === upper);
          if (st) {
            const sp = cryptoPrices.find(p => p.symbol === upper);
            match = { ...st, price: sp?.price ?? 0, change24h: sp?.change24h ?? 0, changePercent24h: sp?.changePercent24h ?? 0, sparkline: [], color: undefined };
          } else {
            // Check tradfi
            const tp = tradfiPrices.find(p => p.symbol === upper);
            if (tp) {
              const tradfiDef = TRADFI_ASSETS.find(a => a.base === upper || a.id === upper);
              match = { id: tp.id, base: tp.symbol, name: tp.name, price: tp.price, change24h: tp.change24h, changePercent24h: tp.changePercent24h, category: "tradfi" as const, color: tradfiDef?.color, sparkline: [] };
            }
          }
        }
        if (match) assets.push(match);
      }
      return assets;
    }

    if (activeCategory === "tradfi") {
      // TradFi tab: show GOLD, OIL, indices, FX
      for (const def of TRADFI_ASSETS) {
        const live = tradfiPrices.find(p => p.symbol === def.base || p.symbol === def.id);
        const sp = tradfiPrices.find(p => p.symbol === def.base || p.symbol === def.id);
        assets.push({
          id: def.id, base: def.base, name: def.name,
          price: live?.price ?? 0,
          change24h: live?.change24h ?? 0,
          changePercent24h: live?.changePercent24h ?? 0,
          category: "tradfi" as const,
          color: def.color,
          sparkline: live?.sparkline ?? [],
        });
      }
      return assets;
    }

    if (activeCategory === "stock") {
      // Stocks tab: filter by sub-pill
      let pool: typeof STOCK_ASSETS = STOCK_ASSETS;
      if (activeSub === "korean_stocks") {
        pool = KOREAN_ASSETS as unknown as typeof STOCK_ASSETS;
      } else if (activeSub === "us_stocks") {
        pool = STOCK_ASSETS.filter(a => !a.isKorean);
      } else {
        pool = STOCK_ASSETS;
      }
      for (const def of pool) {
        const live = cryptoPrices.find(p => p.symbol === def.base || p.id === def.id);
        assets.push({
          id: def.id, base: def.base, name: def.name,
          price: live?.price ?? 0,
          change24h: live?.change24h ?? 0,
          changePercent24h: live?.changePercent24h ?? 0,
          category: "stock" as const,
          sparkline: live?.sparkline ?? [],
          color: undefined,
        });
      }
      return assets;
    }

    // "Hot" or "Gainers" or "New" or default: show crypto + some stocks
    const pool = activeMainTab === "Gainers"
      ? [...CRYPTO_ASSETS, ...STOCK_ASSETS]
      : activeMainTab === "New"
      ? [...CRYPTO_ASSETS, ...STOCK_ASSETS]
      : [...CRYPTO_ASSETS, ...STOCK_ASSETS];

    for (const def of pool) {
      const live = cryptoPrices.find(p => p.symbol === def.base || p.id === def.id);
      assets.push({
        id: def.id, base: def.base, name: def.name,
        price: live?.price ?? 0,
        change24h: live?.change24h ?? 0,
        changePercent24h: live?.changePercent24h ?? 0,
        category: "crypto" as const,
        sparkline: live?.sparkline ?? [],
        color: undefined,
      });
    }
    return assets;
  }, [activeCategory, activeSub, activeMainTab, cryptoPrices, tradfiPrices, favorites]);

  // Sort by gainers if that tab is selected
  const sortedAssets = useMemo(() => {
    if (activeMainTab === "Gainers") {
      return [...displayedAssets].sort((a, b) => b.changePercent24h - a.changePercent24h);
    }
    return displayedAssets;
  }, [displayedAssets, activeMainTab]);

  return (
    <div className="mb-5">
      {/* Main category tabs */}
      <div className="flex gap-1 mb-3 overflow-x-auto scrollbar-hide -mx-1 px-1">
        {MAIN_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => { setActiveMainTab(tab); setActiveSubPill("Trending"); }}
            className={`flex-shrink-0 pb-3 pt-1 px-1 relative text-sm font-bold transition-colors ${
              activeMainTab === tab ? "text-white" : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {tab}
            {activeMainTab === tab && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#2b6be8] rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Sub-category pills */}
      <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 -mx-1 px-1 mb-3">
        {SUBCATEGORIES.map((sub) => (
          <button
            key={sub}
            onClick={() => setActiveSubPill(sub)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
              activeSubPill === sub
                ? "bg-[#2b6be8] text-white"
                : "bg-[#1e2329] text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            }`}
          >
            {sub}
          </button>
        ))}
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[1.8fr_1fr_1.2fr_1fr] gap-2 px-2 py-2 bg-[#121418] rounded-t-2xl border-b border-[#1e2329]">
        <span className="text-slate-500 text-[11px] font-bold uppercase tracking-wider">Asset</span>
        <span className="text-slate-500 text-[11px] font-bold uppercase tracking-wider text-right">Price</span>
        <span className="text-slate-500 text-[11px] font-bold uppercase tracking-wider text-right">24h %</span>
        <span className="text-slate-500 text-[11px] font-bold uppercase tracking-wider text-right">7d Chart</span>
      </div>

      {/* Asset rows */}
      <div className="divide-y divide-[#1e2329]">
        {sortedAssets.map((asset) => {
          const isUp = asset.change24h >= 0;
          const sym = asset.base;
          const bgColor = asset.color ?? (isUp ? "bg-emerald-500/15" : "bg-rose-500/15");
          const textColor = asset.color ? "text-white" : (isUp ? "text-emerald-400" : "text-rose-400");
          return (
            <div
              key={asset.id}
              className="grid grid-cols-[1.8fr_1fr_1.2fr_1fr] gap-2 items-center px-3 py-3 hover:bg-slate-800/30 transition-colors cursor-pointer group relative"
            >
              {/* Asset icon + name + favorite button */}
              <div className="flex items-center gap-2.5">
                <button
                  onClick={(e) => { e.stopPropagation(); toggleFavorite(sym); }}
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs border transition-all shrink-0 ${
                    favorites.includes(sym)
                      ? "bg-[#2b6be8]/20 border-[#2b6be8] text-[#2b6be8]"
                      : "border-[#2a2f3a] text-slate-600 hover:border-[#2b6be8]/50 hover:text-[#2b6be8]"
                  }`}
                  title={favorites.includes(sym) ? "Remove from favorites" : "Add to favorites"}
                >
                  ★
                </button>
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-black shrink-0 ${bgColor} ${textColor}`}>
                  {sym.slice(0, 2)}
                </div>
                <div className="overflow-hidden">
                  <p className="text-white text-sm font-bold leading-tight">{sym}</p>
                  <p className="text-slate-500 text-[10px] font-bold truncate">{asset.name}</p>
                </div>
              </div>

              {/* Price */}
              <div className="text-right">
                <p className="text-white text-sm font-bold">${fmtPrice(asset.price)}</p>
              </div>

              {/* 24h % */}
              <div className="text-right flex items-center justify-end gap-1">
                <PriceBadge change={asset.changePercent24h} />
              </div>

              {/* 7d Dynamic Sparkline */}
              <div className="flex justify-end">
                <Sparkline points={asset.sparkline} change24h={asset.changePercent24h} />
              </div>
            </div>
          );
        })}
        {sortedAssets.length === 0 && (
          <div className="px-4 py-8 text-center text-slate-500 text-sm">No assets in this category.</div>
        )}
      </div>
    </div>
  );
}

// ── Prediction Markets ─────────────────────────────────────────────────────────
const PREDICTIONS = [
  { id: "p1", title: "Will BTC break $120,000 by Friday?", hashtag: "#BTC120K", closeTime: "2h 14m left" },
  { id: "p2", title: "ETH end of week above $4,000?", hashtag: "#ETH4K", closeTime: "5h 32m left" },
  { id: "p3", title: "SOL weekly gain > 10%?", hashtag: "#SOLUP", closeTime: "8h 05m left" },
  { id: "p4", title: "GBP/USD close above 1.32?", hashtag: "#FX", closeTime: "1d 2h left" },
];

function PredictionCarousel() {
  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          <Flame size={16} className="text-amber-400" />
          <h2 className="text-white font-black text-base">EventX Predictions</h2>
        </div>
        <button className="text-[#2b6be8] text-xs font-bold hover:underline flex items-center gap-1">
          See All <ArrowRight size={12} />
        </button>
      </div>
      <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1 -mx-1 px-1 -my-1">
        {PREDICTIONS.map((pred) => (
          <div key={pred.id} className="flex-shrink-0 w-[260px] bg-[#121418] rounded-2xl p-3 border border-[#1e2329]">
            <span className="text-[10px] font-bold text-[#2b6be8] uppercase tracking-widest">{pred.hashtag}</span>
            <p className="text-white text-sm font-bold mt-1 leading-snug">{pred.title}</p>
            <p className="text-slate-500 text-[11px] mt-1 font-medium">{pred.closeTime}</p>
            <div className="flex gap-2 mt-3">
              <button className="flex-1 py-2 rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-xs font-bold hover:bg-emerald-500/25 transition-colors">Yes</button>
              <button className="flex-1 py-2 rounded-xl bg-rose-500/15 text-rose-400 border border-rose-500/30 text-xs font-bold hover:bg-rose-500/25 transition-colors">No</button>
            </div>
            <div className="flex justify-between mt-2 text-[10px] text-slate-500 font-bold">
              <span>Win: 65%</span><span>Payout: 1.52x</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Announcements ─────────────────────────────────────────────────────────────
const ANNOUNCEMENTS = [
  { id: "a1", icon: "🎁", title: "Double Rewards on BTC Pairs", desc: "Trade BTC pairs this weekend for 2x reward points." },
  { id: "a2", icon: "🚀", title: "New Listing: PEPE Perpetuals", desc: "PEPE perpetual contracts are now live. Trade now." },
  { id: "a3", icon: "📢", title: "Maintenance Notice: 02:00–04:00 UTC", desc: "System upgrade scheduled. Minimal downtime expected." },
];

function Announcements() {
  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          <Hash size={16} className="text-[#2b6be8]" />
          <h2 className="text-white font-black text-base">Announcements</h2>
        </div>
        <button className="text-[#2b6be8] text-xs font-bold hover:underline">View All</button>
      </div>
      <div className="space-y-2">
        {ANNOUNCEMENTS.map((ann) => (
          <div key={ann.id} className="bg-[#121418] rounded-2xl p-3 flex items-start gap-3 border border-[#1e2329]">
            <div className="w-9 h-9 rounded-xl bg-[#1e2329] flex items-center justify-center text-lg shrink-0 shadow-inner">{ann.icon}</div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-bold leading-snug">{ann.title}</p>
              <p className="text-slate-500 text-xs mt-0.5 leading-snug">{ann.desc}</p>
            </div>
            <ChevronRight size={16} className="text-slate-600 shrink-0 mt-0.5" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Export ────────────────────────────────────────────────────────────────
interface BingXHomeDashboardProps {
  /** When provided, bottom nav tab changes are forwarded to the app router.
   *  E.g. onTabChange("trade") → switch to futures/manual trading tab. */
  onBottomNavChange?: (tabId: string) => void;
  /** Active bottom nav tab (from app router state) */
  activeBottomTab?: string;
}

export default function BingXHomeDashboard({
  onBottomNavChange,
  activeBottomTab = "home",
}: BingXHomeDashboardProps) {
  const cryptoPrices = useLivePrices();
  const tradfiPrices = useTradFiPrices();

  // If no router callback is given, default behavior: just scroll to top
  const handleNavChange = useCallback((tabId: string) => {
    onBottomNavChange?.(tabId);
  }, [onBottomNavChange]);

  return (
    <div className="min-h-screen bg-[#0b0e11] text-white pb-24 pt-0">
      {/* Top Header — only shown when not in a page that has its own header */}
      <TopHeader />

      <div className="max-w-[600px] mx-auto px-3 pt-3 space-y-1">
        <PromoBanner onCTAClick={() => handleNavChange("trade")} />
        <QuickActionsRow />
        <HotTickerCards cryptoPrices={cryptoPrices.prices} tradfiPrices={tradfiPrices.prices} />
        <MarketTabList cryptoPrices={cryptoPrices.prices} tradfiPrices={tradfiPrices.prices} />
        <PredictionCarousel />
        <Announcements />
      </div>

      {/* Bottom Navigation — wired to app router via onBottomNavChange */}
      <BottomNav onTabChange={handleNavChange} activeTab={activeBottomTab} />
    </div>
  );
}
