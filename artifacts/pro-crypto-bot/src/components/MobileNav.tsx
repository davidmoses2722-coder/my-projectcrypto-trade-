import { Activity, Target, BarChart2, ClipboardList, Bot, Microscope, Beaker, Briefcase, ShieldAlert, Key, TrendingUp, BrainCircuit, Copy, ArrowUpDown, BookOpen } from "lucide-react";

interface MobileNavProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  isBotRunning: boolean;
}

const MOBILE_TABS = [
  { id: "dashboard",       label: "Home",  icon: Activity },
  { id: "manual-trading",  label: "Trade", icon: TrendingUp },
  { id: "futures",         label: "Futures", icon: ArrowUpDown },
  { id: "bot",             label: "Bot",   icon: Bot },
  { id: "trades",          label: "Positions", icon: ClipboardList },
  { id: "capital-protection", label: "Risk", icon: ShieldAlert },
];

export function MobileNav({ activeTab, onTabChange, isBotRunning }: MobileNavProps) {
  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#090a0f]/95 backdrop-blur-xl border-t border-white/5 safe-area-bottom shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">
      <div className="flex items-stretch">
        {MOBILE_TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          const isBotTab = tab.id === "bot";
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex-1 flex flex-col items-center justify-center gap-1 py-3 px-1 transition-all relative ${
                isActive ? "text-cyan-400" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {/* Bot running indicator */}
              {isBotTab && isBotRunning && (
                <span className="absolute top-2.5 right-1/4 w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse" />
              )}
              <Icon size={20} className={isActive ? "drop-shadow-[0_0_8px_rgba(34,211,238,0.5)]" : ""} />
              <span className="text-sm font-semibold leading-none tracking-wide">{tab.label}</span>
              {/* Active indicator */}
              {isActive && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-b-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,1)]" />
              )}
            </button>
          );
        })}
      </div>
      {/* Safe area padding */}
      <div className="h-safe-bottom bg-[#090a0f]" />
    </nav>
  );
}

// ── Mobile More Menu (for tabs not in bottom nav) ────────────────────────────
const MORE_TABS = [
  { id: "signals",    label: "Signals",    icon: Target },
  { id: "orderbook",  label: "Order Book", icon: BarChart2 },
  { id: "analytics",  label: "Analytics",  icon: Microscope },
  { id: "backtest",   label: "Backtest",   icon: Beaker },
  { id: "portfolio",  label: "Portfolio",  icon: Briefcase },
  { id: "deploy",     label: "VPS·Safety", icon: ShieldAlert },
  { id: "settings",   label: "API Keys",   icon: Key },
  { id: "strategy-lab", label: "Strategy Lab", icon: BrainCircuit },
  { id: "copy-trading", label: "Copy Trading", icon: Copy },
  { id: "trade-journal", label: "Journal", icon: BookOpen },
];

interface MobileMoreProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  onClose: () => void;
}

export function MobileMoreMenu({ activeTab, onTabChange, onClose }: MobileMoreProps) {
  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end lg:hidden" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" />
      <div
        className="bg-[#11141d] border-t border-white/10 rounded-t-3xl p-5 pb-safe relative shadow-[0_-10px_40px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-12 h-1.5 bg-slate-700/50 rounded-full mx-auto mb-6" />
        <h3 className="text-[13px] font-bold font-bold text-slate-500 uppercase tracking-widest mb-4 px-2">More Modules</h3>
        <div className="grid grid-cols-2 gap-3">
          {MORE_TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => { onTabChange(tab.id); onClose(); }}
                className={`flex items-center gap-3 px-4 py-3.5 rounded-2xl text-sm font-semibold transition-all active:scale-95 ${
                  activeTab === tab.id
                    ? "bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 shadow-[0_0_15px_rgba(14,165,233,0.15)]"
                    : "premium-glass hover:bg-slate-800/80 text-slate-300"
                }`}
              >
                <Icon size={18} className={activeTab === tab.id ? "" : "text-slate-400"} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
        <button
          onClick={onClose}
          className="mt-6 w-full py-4 rounded-2xl bg-slate-800/50 text-slate-300 font-semibold text-sm hover:bg-slate-800 transition-colors border border-white/5"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
