import { Activity, BrainCircuit, CircleAlert, Gauge, Radio, ShieldAlert, Zap } from "lucide-react";
import type { ServerLogEntry, ServerStatus } from "../hooks/useBotServer";

export function BotOperationsConsole({ status, logs }: { status: ServerStatus; logs: ServerLogEntry[] }) {
  const recent = logs.slice(-80);
  const count = (needle:string) => recent.filter(x => x.msg.toLowerCase().includes(needle)).length;
  const cards = [
    { label:"Signals", value:count("signal"), icon:BrainCircuit, tone:"text-violet-300" },
    { label:"Executions", value:count("fill")+count("execut"), icon:Zap, tone:"text-cyan-300" },
    { label:"Risk events", value:count("risk")+count("block"), icon:ShieldAlert, tone:"text-amber-300" },
    { label:"Alerts", value:count("error")+count("warn"), icon:CircleAlert, tone:"text-rose-300" },
  ];
  const latest = recent.slice(-6).reverse();
  return <section className="premium-glass rounded-2xl p-4 space-y-4">
    <div className="flex items-center justify-between"><div><div className="premium-eyebrow"><Radio size={14}/> Live operations</div><h3 className="text-lg font-black text-white">Bot Operations Center</h3></div><span className="live-pill"><span/> {status.isRunning?"ENGINE ACTIVE":"ENGINE IDLE"}</span></div>
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">{cards.map(c=>{const I=c.icon;return <div key={c.label} className="rounded-xl border border-white/5 bg-slate-950/50 p-3"><I size={15} className={c.tone}/><div className="mt-2 text-xl font-black text-white">{c.value}</div><div className="text-[10px] uppercase tracking-wider text-slate-500">{c.label}</div></div>})}</div>
    <div className="grid sm:grid-cols-3 gap-2 text-xs">
      <div className="rounded-xl bg-white/[.03] border border-white/5 p-3"><Gauge className="inline text-cyan-400 mr-1" size={14}/> Strategy <b className="text-white">{status.activeStrategy ?? "—"}</b></div>
      <div className="rounded-xl bg-white/[.03] border border-white/5 p-3"><Activity className="inline text-emerald-400 mr-1" size={14}/> Trades <b className="text-white">{status.totalTrades}</b></div>
      <div className="rounded-xl bg-white/[.03] border border-white/5 p-3">P&L <b className={status.dailyPnL>=0?"text-emerald-400":"text-rose-400"}>${status.dailyPnL.toFixed(2)}</b></div>
    </div>
    <div className="rounded-xl border border-white/5 overflow-hidden"><div className="px-3 py-2 bg-white/[.02] text-[10px] font-black uppercase tracking-widest text-slate-500">Decision stream · latest events</div>{latest.length?<div className="divide-y divide-white/5">{latest.map((l,i)=><div key={i} className="px-3 py-2 flex gap-3 text-xs"><span className="text-slate-600">{new Date(l.ts).toLocaleTimeString()}</span><span className={l.level==="ERROR"?"text-rose-400":l.level==="WARN"?"text-amber-300":"text-slate-300"}>{l.msg}</span></div>)}</div>:<div className="p-5 text-center text-slate-600 text-xs">Start the bot to populate live decisions.</div>}</div>
  </section>;
}
