import { useState, useEffect, useRef } from 'react';
import { View, NavigationProps } from '../types';
import { useAuth } from '../context/AuthContext';
import { auth, signOut } from '../lib/firebase';
import { getUsage, UsageData } from '../lib/api';
import { recordDailyVisit, daysUntilGoal, StreakState } from '../lib/streak';

// ── Dock items ──────────────────────────────────────────────────────────
const DOCK_ITEMS: { view: View; label: string; icon: string }[] = [
  { view: 'nexus',         label: 'Nexus',          icon: 'dashboard' },
  { view: 'dialogue',      label: 'Dialogue',       icon: 'forum' },
  { view: 'knowledge-map', label: 'Knowledge Tree', icon: 'hub' },
  { view: 'problem-sets',  label: 'Problem Sets',   icon: 'library_books' },
  { view: 'notes',         label: 'Feynman Notes',  icon: 'edit_note' },
  { view: 'mistake-bank',  label: 'Mistake Vault',  icon: 'error_outline' },
  { view: 'reference-bank', label: 'Reference Bank', icon: 'auto_stories' },
  { view: 'progress',      label: 'Progress',       icon: 'bar_chart' },
];

const PROVIDERS: { key: string; label: string; color: string }[] = [
  { key: 'groq',       label: 'Groq / Llama',   color: '#FF6B35' },
  { key: 'google',     label: 'Google Gemini',  color: '#4285F4' },
  { key: 'nvidia',     label: 'NVIDIA NIM',     color: '#76B900' },
  { key: 'openrouter', label: 'OpenRouter',     color: '#7C3AED' },
  { key: 'ollama',     label: 'Ollama',         color: '#6B7280' },
];

function UsagePanel({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getUsage().then(d => { setData(d); setLoading(false); });
  }, []);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const totalReq = data?.total_calls ?? 0;
  const totalTok = data?.total_tokens ?? 0;

  return (
    <div
      ref={ref}
      data-tour="usage-panel"
      className="absolute bottom-full right-0 mb-2 w-80 glass-strong rounded-2xl z-[200] overflow-hidden"
      style={{ animation: 'fadeDown 0.18s ease-out' }}
    >
      <style>{`@keyframes fadeDown { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }`}</style>

      <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-white/50">AI Usage — This Session</span>
        <button onClick={onClose} className="opacity-30 hover:opacity-80 transition-opacity">
          <span className="material-symbols-outlined text-[14px]">close</span>
        </button>
      </div>

      <div className="px-5 py-4 flex flex-col gap-4">
        {loading ? (
          <div className="flex items-center gap-3 py-2">
            <div className="w-3 h-3 border border-white/20 border-t-white rounded-full animate-spin" />
            <span className="text-xs text-white/40">Loading…</span>
          </div>
        ) : totalReq === 0 ? (
          <p className="text-xs text-white/40 text-center py-2">No AI calls yet this session.</p>
        ) : (
          <>
            {PROVIDERS.map(({ key, label, color }) => {
              const p = data?.by_provider?.[key];
              if (!p || p.requests === 0) return null;
              const pctReq = totalReq > 0 ? (p.requests / totalReq) * 100 : 0;
              const tok = p.prompt + p.completion;
              return (
                <div key={key}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                      <span className="text-[11px] text-white/70">{label}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] text-white/40">{p.requests} calls</span>
                      <span className="text-[11px] font-semibold text-white/60" style={{ minWidth: 36, textAlign: 'right' }}>
                        {pctReq.toFixed(0)}%
                      </span>
                    </div>
                  </div>
                  <div className="h-1.5 w-full bg-white/5 overflow-hidden rounded-full">
                    <div className="h-full transition-all duration-500 rounded-full" style={{ width: `${pctReq}%`, background: color, opacity: 0.85 }} />
                  </div>
                  {tok > 0 && (
                    <p className="text-[9px] text-white/30 mt-0.5 text-right">{tok.toLocaleString()} tokens</p>
                  )}
                </div>
              );
            })}
            <div className="border-t border-white/10 pt-3 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-white/50">Total</span>
              <div className="flex items-center gap-4">
                <span className="text-[10px] text-white/40">{totalReq} calls</span>
                <span className="text-[10px] text-white/40">{totalTok.toLocaleString()} tokens</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Glassy chess-piece streak badge: pawn while chasing the goal date, king once reached. */
function StreakPanel({ state, onClose }: { state: StreakState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const remaining = daysUntilGoal(state);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      data-tour="streak-panel"
      className="absolute bottom-full right-0 mb-2 w-64 glass-strong rounded-2xl z-[200] overflow-hidden"
      style={{ animation: 'fadeDown 0.18s ease-out' }}
    >
      <div className="px-5 py-4 flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <span className="text-[28px] leading-none" style={{ filter: 'drop-shadow(0 0 6px rgba(216,204,255,0.5))' }}>
            {state.goalAchieved ? '♚' : '♟'}
          </span>
          <div>
            <div className="text-lg font-semibold text-white/90">{state.streakCount}-day streak</div>
            <div className="text-[10px] uppercase tracking-wider text-white/40">Longest: {state.longestStreak}</div>
          </div>
        </div>
        <div className="border-t border-white/10 pt-3">
          <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1">
            {state.goalAchieved ? 'Goal reached' : 'Target'}
          </div>
          <div className="text-xs text-white/70">{state.goalLabel || 'Study goal'}</div>
          <div className="text-[10px] text-white/40 mt-0.5">
            {state.goalDate}{!state.goalAchieved && (remaining >= 0 ? ` — ${remaining}d left` : ' — passed')}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Top-right corner utility capsule: brand mark + usage stats + auth */
function CornerMenu({ onNavigate }: NavigationProps) {
  const { user, devMode } = useAuth();
  const [showStats, setShowStats] = useState(false);
  const [showStreak, setShowStreak] = useState(false);
  const [streak, setStreak] = useState<StreakState | null>(null);

  useEffect(() => { setStreak(recordDailyVisit()); }, []);

  async function handleSignOut() {
    try { await signOut(auth); } catch {}
    onNavigate('auth');
  }

  return (
    <div className="fixed top-6 right-6 z-50 flex items-center gap-2">
      <div
        data-tour="corner-brand"
        className="glass rounded-full px-4 py-2 text-xs font-medium tracking-wider uppercase text-white/80 cursor-pointer hover:bg-white/10 transition-colors"
        onClick={() => onNavigate('nexus')}
      >
        Lyceum
      </div>

      {streak && (
        <div className="relative glass rounded-full flex items-center gap-1 px-1.5 py-1.5">
          <button
            data-tour="corner-streak"
            onClick={() => setShowStreak(v => !v)}
            className="h-8 flex items-center gap-1 px-2 rounded-full opacity-70 hover:opacity-100 hover:bg-white/10 transition-all"
            title={`${streak.streakCount}-day streak`}
          >
            <span className="text-[16px] leading-none">{streak.goalAchieved ? '♚' : '♟'}</span>
            <span className="text-[11px] font-semibold text-white/80">{streak.streakCount}</span>
          </button>
          {showStreak && <StreakPanel state={streak} onClose={() => setShowStreak(false)} />}
        </div>
      )}

      <div className="relative glass rounded-full flex items-center gap-1 px-1.5 py-1.5">
        <button
          data-tour="corner-usage"
          onClick={() => setShowStats(v => !v)}
          className="w-8 h-8 flex items-center justify-center rounded-full opacity-40 hover:opacity-90 hover:bg-white/10 transition-all"
          title="AI Usage"
        >
          <span className="material-symbols-outlined text-[16px]">analytics</span>
        </button>
        {showStats && <UsagePanel onClose={() => setShowStats(false)} />}

        <button
          onClick={() => onNavigate('settings')}
          className="w-8 h-8 flex items-center justify-center rounded-full opacity-40 hover:opacity-90 hover:bg-white/10 transition-all"
          title="Settings"
        >
          <span className="material-symbols-outlined text-[16px]">settings</span>
        </button>

        {user ? (
          <button
            onClick={handleSignOut}
            className="w-8 h-8 flex items-center justify-center rounded-full opacity-40 hover:opacity-90 hover:bg-white/10 transition-all"
            title={user.displayName || user.email || 'Sign out'}
          >
            <span className="material-symbols-outlined text-[16px]">logout</span>
          </button>
        ) : devMode ? (
          <span className="text-[9px] text-white/30 px-2">DEV</span>
        ) : (
          <button
            onClick={() => onNavigate('auth')}
            className="w-8 h-8 flex items-center justify-center rounded-full opacity-40 hover:opacity-90 hover:bg-white/10 transition-all"
            title="Sign in"
          >
            <span className="material-symbols-outlined text-[16px]">login</span>
          </button>
        )}
      </div>
    </div>
  );
}

export default function FloatingDock({ currentView, onNavigate }: NavigationProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      <CornerMenu currentView={currentView} onNavigate={onNavigate} />

      {/* Desktop floating dock — bottom center, visionOS style */}
      <nav className="hidden md:flex fixed bottom-6 left-1/2 -translate-x-1/2 z-50 dock rounded-3xl px-3 py-3 items-end gap-1">
        {DOCK_ITEMS.map(({ view, label, icon }) => {
          const active = currentView === view;
          return (
            <button
              key={view}
              data-tour={`dock-${view}`}
              onClick={() => onNavigate(view)}
              className="dock-icon group relative flex flex-col items-center justify-center w-12 h-12 rounded-2xl"
              title={label}
            >
              <span
                className="material-symbols-outlined text-[22px] transition-colors"
                style={{ color: active ? '#d8ccff' : 'rgba(255,255,255,0.6)' }}
              >
                {icon}
              </span>

              {/* Active glowing dot */}
              <span
                className="dock-dot absolute -bottom-1.5 w-1 h-1 rounded-full transition-opacity"
                style={{
                  background: '#a78bfa',
                  color: '#a78bfa',
                  opacity: active ? 1 : 0,
                }}
              />

              {/* Hover label tooltip */}
              <span className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap glass-strong rounded-lg px-2.5 py-1 text-[10px] text-white/80 opacity-0 group-hover:opacity-100 transition-opacity">
                {label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Mobile: compact bottom bar + expandable sheet */}
      <div className="md:hidden fixed bottom-4 left-4 right-4 z-50">
        <div className="dock rounded-2xl flex items-center justify-between px-4 py-3">
          <span className="text-xs uppercase tracking-widest text-white/70">
            {DOCK_ITEMS.find(i => i.view === currentView)?.label || 'Lyceum'}
          </span>
          <button onClick={() => setMobileOpen(v => !v)} className="opacity-70">
            <span className="material-symbols-outlined text-[20px]">{mobileOpen ? 'close' : 'apps'}</span>
          </button>
        </div>
        {mobileOpen && (
          <div className="dock rounded-2xl mt-2 grid grid-cols-3 gap-1 p-2">
            {DOCK_ITEMS.map(({ view, label, icon }) => (
              <button
                key={view}
                onClick={() => { onNavigate(view); setMobileOpen(false); }}
                className={`flex flex-col items-center gap-1 rounded-xl py-3 transition-colors ${
                  currentView === view ? 'bg-white/10 text-white' : 'text-white/50'
                }`}
              >
                <span className="material-symbols-outlined text-[20px]">{icon}</span>
                <span className="text-[8px] uppercase tracking-wide">{label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
