// ─────────────────────────────────────────────────────────────────────────────
// DeploymentView — VPS deployment + Safety + Performance all-in-one
// VPS tab now wired to real /api/system-health data via SafetyDashboard's
// "VPS Health" sub-tab. This file keeps the outer shell + checklist.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import { SafetyDashboard } from "./SafetyDashboard";
import { PerformanceTracker } from "./PerformanceTracker";
import { RiskState, RiskLimits } from "../utils/riskManager";
import { PremiumCard, PremiumCardContent } from "./premium/PremiumCard";

interface Props {
  riskState:      RiskState;
  limits:         RiskLimits;
  onUpdateLimits: (u: Partial<RiskLimits>) => void;
  isBotRunning:   boolean;
  onStopBot:      () => void;
  botLog:         string[];
}

type Tab = "safety" | "performance" | "vps" | "checklist";

function CodeBlock({ code, lang = "bash" }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="relative group bg-gray-950 border border-gray-700/50 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800/60 border-b border-gray-700/50">
        <span className="text-sm text-gray-500">{lang}</span>
        <button onClick={copy} className="text-sm text-gray-500 hover:text-cyan-400 transition-colors">
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="text-sm text-gray-300 font-mono p-3 overflow-x-auto whitespace-pre leading-relaxed">{code}</pre>
    </div>
  );
}

function Step({ n, title, children, color = "cyan" }: { n: number; title: string; children: React.ReactNode; color?: string }) {
  const [open, setOpen] = useState(n <= 2);
  const colors: Record<string, string> = {
    cyan:   "bg-cyan-500   text-white border-cyan-500/30",
    green:  "bg-green-500  text-white border-green-500/30",
    yellow: "bg-yellow-500 text-black border-yellow-500/30",
    purple: "bg-purple-500 text-white border-purple-500/30",
    orange: "bg-orange-500 text-white border-orange-500/30",
    red:    "bg-red-500    text-white border-red-500/30",
  };
  return (
    <div className={`border rounded-xl overflow-hidden ${colors[color]!.split(" ").slice(2).join(" ")}`}>
      <button onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-white/5 transition-colors">
        <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-black shrink-0 ${colors[color]!.split(" ").slice(0, 2).join(" ")}`}>{n}</span>
        <span className="text-white font-semibold text-sm">{title}</span>
        <span className="ml-auto text-gray-500">{open ? "▲" : "▼"}</span>
      </button>
      {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </div>
  );
}

export function DeploymentView({ riskState, limits, onUpdateLimits, isBotRunning, onStopBot, botLog }: Props) {
  const [tab, setTab] = useState<Tab>("safety");

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-white font-black text-xl">VPS · Safety · Performance</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            24/7 deployment · Account protection · Auto logging · Performance tracking
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold border ${
            riskState.status === "SAFE"    ? "bg-green-500/10 border-green-500/30 text-green-400" :
            riskState.status === "CAUTION" ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-400" :
            riskState.status === "WARNING" ? "bg-orange-500/10 border-orange-500/30 text-orange-400" :
            riskState.status === "DANGER"  ? "bg-red-500/10 border-red-500/30 text-red-400" :
                                             "bg-red-900/30 border-red-500/60 text-red-300"
          }`}>
            {riskState.status}
          </div>
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold border ${
            isBotRunning
              ? "bg-green-500/10 border-green-500/30 text-green-400"
              : "bg-gray-700/30 border-gray-600/30 text-gray-500"
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isBotRunning ? "bg-green-400 animate-pulse" : "bg-gray-600"}`} />
            {isBotRunning ? "BOT LIVE" : "BOT OFF"}
          </div>
        </div>
      </div>

      {/* Risk score summary bar */}
      <div className="flex items-center gap-3 bg-slate-900/50 border border-slate-700/50 rounded-xl px-4 py-2.5">
        <span className="text-sm text-gray-400">Risk Score:</span>
        <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              riskState.riskScore >= 70 ? "bg-red-500" :
              riskState.riskScore >= 50 ? "bg-orange-400" :
              riskState.riskScore >= 30 ? "bg-yellow-400" : "bg-green-500"
            }`}
            style={{ width: `${riskState.riskScore}%` }}
          />
        </div>
        <span className="text-white font-bold text-sm w-8 text-right">{riskState.riskScore}/100</span>
        <div className="w-px h-4 bg-gray-700" />
        <span className="text-sm text-gray-400">Drawdown:</span>
        <span className={`text-sm font-bold ${riskState.drawdown < 5 ? "text-green-400" : "text-red-400"}`}>{riskState.drawdown.toFixed(1)}%</span>
        <div className="w-px h-4 bg-gray-700" />
        <span className="text-sm text-gray-400">Daily P&L:</span>
        <span className={`text-sm font-bold ${riskState.dailyPnL >= 0 ? "text-green-400" : "text-red-400"}`}>
          {riskState.dailyPnL >= 0 ? "+" : ""}${riskState.dailyPnL.toFixed(2)}
        </span>
        <div className="w-px h-4 bg-gray-700" />
        <span className="text-sm text-gray-400">Circuit Breaker:</span>
        <span className={`text-sm font-bold ${riskState.circuitBreakerTripped ? "text-red-400" : "text-green-400"}`}>
          {riskState.circuitBreakerTripped ? "TRIPPED" : "OK"}
        </span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-900/50 border border-slate-700/50 rounded-xl p-1">
        {([
          ["safety",      "Safety"],
          ["performance", "Performance"],
          ["vps",         "VPS Deploy"],
          ["checklist",   "Checklist"],
        ] as [Tab, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex-1 text-sm font-semibold py-2 rounded-lg transition-all ${
              tab === id ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30" : "text-gray-500 hover:text-gray-300"
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* Safety Tab — includes VPS Health sub-tab */}
      {tab === "safety" && (
        <SafetyDashboard
          riskState={riskState}
          limits={limits}
          onUpdateLimits={onUpdateLimits}
          isBotRunning={isBotRunning}
          onStopBot={onStopBot}
        />
      )}

      {/* Performance Tab */}
      {tab === "performance" && <PerformanceTracker botLog={botLog} />}

      {/* VPS Deploy Tab */}
      {tab === "vps" && (
        <div className="space-y-3">
          <Step n={1} title="Provision VPS (Ubuntu 22.04 LTS)" color="cyan">
            <p className="text-sm text-gray-400">Recommended: Hetzner CX11 ($4.5/mo) · DigitalOcean Droplet $6/mo · Vultr Cloud Compute $6/mo</p>
            <CodeBlock lang="bash" code={`# Connect to your VPS
ssh root@YOUR_VPS_IP

# Update system
apt update && apt upgrade -y

# Install Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Verify
node -v  # Should be v20.x
npm -v   # Should be 10.x`} />
          </Step>

          <Step n={2} title="Clone & Build the Bot" color="green">
            <CodeBlock lang="bash" code={`# Install git
apt install -y git

# Clone your repo (or upload via scp)
git clone https://github.com/yourusername/pro-crypto-bot.git
cd pro-crypto-bot

# Create environment file
cat > .env << 'EOF'
GATE_API_KEY=your_gate_api_key
GATE_API_SECRET=your_gate_api_secret
JWT_SECRET=your_jwt_secret
EOF

# Install dependencies & build
npm install && npm run build`} />
          </Step>

          <Step n={3} title="Install PM2 & Run 24/7" color="yellow">
            <p className="text-sm text-gray-400">PM2 keeps the bot running forever — auto-restarts on crash, survives reboots.</p>
            <CodeBlock lang="bash" code={`# Install PM2 globally
npm install -g pm2

# Start the API server
pm2 start npm --name "procryptobot-api" -- run start

# Check it's running
pm2 status
pm2 logs procryptobot-api

# Enable auto-start on server reboot
pm2 startup
# Run the command PM2 outputs above

pm2 save

# Useful PM2 commands
pm2 restart procryptobot-api
pm2 monit             # Live dashboard
pm2 logs --lines 200  # Recent logs`} />
          </Step>

          <Step n={4} title="Nginx Reverse Proxy + SSL" color="purple">
            <CodeBlock lang="bash" code={`# Install Nginx & Certbot
apt install -y nginx certbot python3-certbot-nginx

# Create Nginx config
cat > /etc/nginx/sites-available/procryptobot << 'EOF'
server {
    listen 80;
    server_name yourdomain.com;

    location /api {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location / {
        proxy_pass http://localhost:5173;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
    }
}
EOF

ln -s /etc/nginx/sites-available/procryptobot /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# Free SSL certificate
certbot --nginx -d yourdomain.com`} />
          </Step>

          <Step n={5} title="UFW Firewall Security" color="orange">
            <CodeBlock lang="bash" code={`# Enable UFW firewall
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 'Nginx Full'
ufw enable
ufw status

# Install Fail2ban
apt install -y fail2ban
systemctl enable fail2ban && systemctl start fail2ban`} />
          </Step>

          <Step n={6} title="Auto Log Rotation + Monitoring" color="red">
            <CodeBlock lang="bash" code={`# PM2 log rotation
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true

# System monitoring
apt install -y htop nethogs iotop

# Set up uptime monitoring: uptimerobot.com (free tier)
# → alerts via Telegram if bot goes down`} />
          </Step>
        </div>
      )}

      {/* Checklist Tab */}
      {tab === "checklist" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            {
              title: "Security Checklist",
              color: "border-red-500/20",
              items: [
                "Gate.io API: restrict to VPS IP only",
                "Gate.io API: disable withdrawals permission",
                "Gate.io API: enable Read + Trade only",
                "SSH: use key auth, disable password login",
                "UFW: only ports 22, 80, 443 open",
                "Fail2ban: installed and running",
                ".env: never commit to git (add to .gitignore)",
                "SSL certificate: installed via Certbot",
                "PM2: set memory restart limit (--max-memory-restart 500M)",
                "Telegram: test alert working before going live",
              ],
            },
            {
              title: "Risk Limits Checklist",
              color: "border-yellow-500/20",
              items: [
                `Daily loss limit: ${limits.maxDailyLossPercent}%`,
                `Max drawdown: ${limits.maxDrawdownPercent}%`,
                `Max open positions: ${limits.maxOpenPositions}`,
                `Max single trade risk: ${limits.maxSingleTradeRisk}%`,
                `Consecutive loss limit: ${limits.maxConsecutiveLosses}`,
                `Min win rate warning: ${limits.minWinRatePercent}%`,
                "Stop-loss on every trade configured",
                "Take-profit on every trade configured",
                "Circuit breaker tested (simulation mode)",
                "Telegram alerts verified (test message sent)",
              ],
            },
            {
              title: "Performance Checklist",
              color: "border-green-500/20",
              items: [
                "Logger initialized and persisting to DB",
                "Trade history exportable",
                "Equity curve tracking active",
                "Drawdown monitoring active",
                "Win rate tracked (need >=20 trades for reliable data)",
                "Profit factor > 1.0 (aim for > 1.5)",
                "Sharpe ratio > 0 (aim for > 1.0)",
                "Average win > average loss (positive R:R)",
                "Weekly performance review scheduled",
                "Monthly parameter optimization scheduled",
              ],
            },
            {
              title: "VPS Checklist",
              color: "border-cyan-500/20",
              items: [
                "Ubuntu 22.04 LTS installed",
                "Node.js 20 LTS installed",
                "Bot built and API server running",
                "PM2 running: pm2 status shows 'online'",
                "PM2 startup configured: pm2 startup + pm2 save",
                "Nginx installed and proxying correctly",
                "SSL certificate installed (port 443)",
                "Log rotation configured (pm2-logrotate)",
                "UptimeRobot monitoring set up",
                "Backups: .env and config backed up",
              ],
            },
            {
              title: "Emergency Procedures",
              color: "border-purple-500/20",
              items: [
                "STOP BOT: pm2 stop procryptobot-api",
                "CANCEL ALL ORDERS: Gate.io dashboard -> cancel all",
                "CLOSE POSITIONS: manually on Gate.io",
                "DISABLE API KEY: Gate.io -> API Management -> Delete",
                "EMERGENCY CONTACT: Telegram bot sends critical alerts",
                "LOG CHECK: pm2 logs procryptobot-api --lines 500",
                "RESTART: pm2 restart procryptobot-api",
                "REBUILD: git pull && npm install && npm run build",
                "ROLLBACK: git checkout LAST_GOOD_COMMIT && rebuild",
                "Capital Protection Kill Switch available in Safety tab",
              ],
            },
            {
              title: "Account Safety Rules",
              color: "border-orange-500/20",
              items: [
                "NEVER trade with more than you can afford to lose",
                "Start with 1-2% risk per trade maximum",
                "Test circuit breakers in simulation before going live",
                "Run paper trading for >=1 week before real money",
                "Daily loss limit = 3% of account (halt if hit)",
                "Only increase position size after 20+ profitable trades",
                "Review and optimize every 4 weeks",
                "Withdraw profits monthly — never compound unchecked",
                "Never revenge trade after losses — bot has cooldown",
                "If in doubt, STOP THE BOT — capital preservation first",
              ],
            },
          ].map(({ title, color, items }) => (
            <div key={title} className={`bg-slate-900/50 border rounded-xl p-4 ${color}`}>
              <h3 className="text-base font-bold text-white mb-3">{title}</h3>
              <div className="space-y-1.5">
                {items.map((item, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <span className="text-green-400 mt-0.5 shrink-0">+</span>
                    <span className="text-gray-400">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
