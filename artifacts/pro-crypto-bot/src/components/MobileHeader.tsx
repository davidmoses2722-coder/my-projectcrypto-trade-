import { Lock, MoreHorizontal } from "lucide-react";
import { StatusBadge } from "./premium/StatusBadge";

interface MobileHeaderProps {
  isBotRunning: boolean;
  connectionStatus: "connecting" | "live" | "simulated";
  fearGreedIndex: number;
  onLock: () => void;
  onMore: () => void;
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const TAB_LABELS: Record<string, string> = {
  dashboard:  "Dashboard",
  signals:    "AI Signals",
  orderbook:  "Order Book",
  analytics:  "Analytics",
  portfolio:  "Portfolio",
  trades:     "Trade History",
  bot:        "Bot Control",
  serverbot:  "Bot Control",
  pythonbot:  "Bot Control",
  deploy:     "VPS · Safety",
  settings:   "API Keys",
};

export function MobileHeader({
  isBotRunning,
  connectionStatus,
  fearGreedIndex,
  onLock,
  onMore,
  activeTab,
}: MobileHeaderProps) {
  const fgColor =
    fearGreedIndex >= 70 ? "text-emerald-400" :
    fearGreedIndex >= 45 ? "text-amber-400" : "text-rose-400";

  return (
    <header className="lg:hidden sticky top-0 z-40 bg-[#090a0f]/95 backdrop-blur-xl border-b border-white/5">
      <div className="flex items-center justify-between px-4 py-3">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-sm font-bold shadow-[0_0_15px_rgba(14,165,233,0.3)] shrink-0">
            PCB
          </div>
          <div>
            <span className="font-black text-white text-[15px] tracking-tight leading-none block">
              PRO<span className="text-cyan-400">CRYPTO</span>
            </span>
            <p className="text-slate-400 text-[13px] font-bold font-semibold tracking-widest uppercase mt-0.5">{TAB_LABELS[activeTab] ?? "Dashboard"}</p>
          </div>
        </div>

        {/* Status pills */}
        <div className="flex items-center gap-3">
          {/* Bot status */}
          {isBotRunning && (
            <StatusBadge variant="live" label="LIVE" pulse glow />
          )}

          {/* Lock button */}
          <button
            onClick={onLock}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-800/50 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors border border-white/5"
            title="Lock dashboard"
          >
            <Lock size={14} />
          </button>

          {/* More menu */}
          <button
            onClick={onMore}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-800/50 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors border border-white/5"
            title="More options"
          >
            <MoreHorizontal size={18} />
          </button>
        </div>
      </div>
    </header>
  );
}
