import { useState } from "react";
import type { AuthState, AuthMode } from "../hooks/useAuth";
import { Lock, User, KeyRound, ShieldCheck, Mail, ArrowRight, Loader2, Info } from "lucide-react";
import { PremiumCard, PremiumCardContent } from "./premium/PremiumCard";
import { StatusBadge } from "./premium/StatusBadge";

interface LoginScreenProps {
  state: AuthState;
  error: string;
  attempts: number;
  onLogin: (usernameOrEmail: string, password: string) => Promise<boolean>;
  onSetup: (username: string, password: string) => Promise<boolean>;
  onReset: () => void;
}

export function LoginScreen({ state, error, onLogin, onSetup, onReset }: LoginScreenProps) {
  const [mode, setMode]         = useState<AuthMode>(state === "setup" ? "register" : "login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [loading, setLoading]   = useState(false);
  const [localErr, setLocalErr] = useState("");

  const isRegister = mode === "register";
  const displayErr = localErr || error;

  const handleSubmit = async () => {
    setLocalErr("");
    if (!username.trim() || !password) {
      setLocalErr("Please fill in all fields");
      return;
    }
    if (isRegister) {
      if (password.length < 8) {
        setLocalErr("Password must be at least 8 characters");
        return;
      }
      if (password !== confirm) {
        setLocalErr("Passwords do not match");
        return;
      }
    }
    setLoading(true);
    const ok = isRegister
      ? await onSetup(username.trim(), password)
      : await onLogin(username.trim(), password);
    setLoading(false);
    if (!ok) {
      setPassword("");
      setConfirm("");
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") void handleSubmit();
  };

  const switchMode = () => {
    setMode(isRegister ? "login" : "register");
    setLocalErr("");
    setPassword("");
    setConfirm("");
  };

  return (
    <div className="min-h-[100dvh] bg-[#090a0f] flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[500px] h-[500px] bg-cyan-500/5 rounded-full blur-[100px]" />
        <div className="absolute bottom-1/4 left-1/2 -translate-x-1/2 w-[400px] h-[400px] bg-blue-600/5 rounded-full blur-[100px]" />
      </div>

      <div className="relative w-full max-w-md z-10">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 text-3xl font-black text-white shadow-[0_0_30px_rgba(14,165,233,0.3)] mb-5">
            ET
          </div>
          <h1 className="text-3xl font-black text-white tracking-tight">
            ELITE<span className="text-cyan-400">-TRADE</span>
          </h1>
          <p className="text-slate-400 text-sm mt-2 font-medium tracking-wide uppercase">Trading &amp; Automation Platform</p>
        </div>

        {/* Card */}
        <PremiumCard className="shadow-2xl shadow-cyan-900/10">
          <PremiumCardContent className="p-8">
            {/* Status badges */}
            <div className="flex items-center justify-center gap-3 mb-6">
              <StatusBadge variant="safe" label="System Online" pulse />
              <StatusBadge variant="live" label="Engine Ready" />
            </div>

            {/* Mode toggle */}
            <div className="flex rounded-xl overflow-hidden bg-slate-900/50 p-1 mb-6 border border-white/5">
              <button
                onClick={() => { setMode("login"); setLocalErr(""); }}
                className={`flex-1 py-2.5 text-sm font-bold transition-all rounded-lg ${
                  mode === "login"
                    ? "bg-slate-800 text-cyan-400 shadow-md border border-white/5"
                    : "bg-transparent text-slate-500 hover:text-slate-300"
                }`}
              >
                Login
              </button>
              <button
                onClick={() => { setMode("register"); setLocalErr(""); }}
                className={`flex-1 py-2.5 text-sm font-bold transition-all rounded-lg ${
                  mode === "register"
                    ? "bg-slate-800 text-cyan-400 shadow-md border border-white/5"
                    : "bg-transparent text-slate-500 hover:text-slate-300"
                }`}
              >
                Register
              </button>
            </div>

            {/* Title */}
            <div className="text-center mb-6">
              <h2 className="text-slate-200 font-bold text-lg">
                {isRegister ? "Create Your Secure Key" : "Terminal Access"}
              </h2>
              <p className="text-slate-500 text-sm mt-1">
                {isRegister
                  ? "Set up your credentials for terminal access"
                  : state === "locked"
                  ? "Session locked — authenticate to resume"
                  : "Enter credentials to connect"}
              </p>
            </div>

            {/* Fields */}
            <div className="space-y-4 mb-6">
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <User className="h-5 w-5 text-slate-500" />
                </div>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onKeyDown={handleKey}
                  placeholder={isRegister ? "Username" : "Username or Email"}
                  autoComplete={isRegister ? "username" : "username email"}
                  className="w-full pl-11 pr-4 py-3.5 rounded-xl bg-slate-900/50 border border-white/10 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50 transition-all font-medium"
                />
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <KeyRound className="h-5 w-5 text-slate-500" />
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={handleKey}
                  placeholder={isRegister ? "Password (min. 8 chars)" : "Password"}
                  autoComplete={isRegister ? "new-password" : "current-password"}
                  className="w-full pl-11 pr-4 py-3.5 rounded-xl bg-slate-900/50 border border-white/10 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50 transition-all font-medium"
                />
              </div>
              {isRegister && (
                <div className="relative animate-slide-up">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <ShieldCheck className="h-5 w-5 text-slate-500" />
                  </div>
                  <input
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    onKeyDown={handleKey}
                    placeholder="Confirm Password"
                    autoComplete="new-password"
                    className="w-full pl-11 pr-4 py-3.5 rounded-xl bg-slate-900/50 border border-white/10 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50 transition-all font-medium"
                  />
                </div>
              )}
            </div>

            {/* Error */}
            {displayErr && (
              <div className="mb-6 px-4 py-3 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-start gap-3 animate-shake">
                <Info className="text-rose-400 shrink-0 mt-0.5" size={16} />
                <p className="text-rose-400 text-sm font-medium">{displayErr}</p>
              </div>
            )}

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="w-full py-4 rounded-xl font-bold text-sm transition-all bg-cyan-600 hover:bg-cyan-500 text-white shadow-[0_0_20px_rgba(8,145,178,0.4)] hover:shadow-[0_0_30px_rgba(8,145,178,0.6)] disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="animate-spin" size={18} />
                  {isRegister ? "Creating Access..." : "Authenticating..."}
                </>
              ) : (
                <>
                  {isRegister ? "Initialize Terminal" : "Connect"}
                  <ArrowRight size={18} />
                </>
              )}
            </button>

            {/* Reset for locked state */}
            {state === "locked" && (
              <button
                onClick={onReset}
                className="mt-6 w-full py-2 text-sm font-semibold text-slate-500 hover:text-rose-400 transition-colors flex items-center justify-center gap-2"
              >
                Clear session & start over
              </button>
            )}
          </PremiumCardContent>
        </PremiumCard>

        {/* Footer */}
        <div className="text-center mt-8 space-y-3">
          <div className="flex items-center justify-center gap-6 text-sm font-medium text-slate-500">
            <span className="flex items-center gap-2"><Lock size={14} className="text-cyan-500" /> Local Encrypted</span>
            <span className="flex items-center gap-2"><ShieldCheck size={14} className="text-emerald-500" /> Secure Transport</span>
          </div>
          <p className="text-xs text-slate-600 font-medium tracking-wide">Terminal auto-locks after 30 min inactivity</p>
        </div>
      </div>
    </div>
  );
}
