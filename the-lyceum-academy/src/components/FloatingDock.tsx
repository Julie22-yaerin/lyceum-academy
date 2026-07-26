import { useState, useEffect, useRef } from 'react';
import { View, NavigationProps } from '../types';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { auth, signOut } from '../lib/firebase';
import { recordDailyVisit, daysUntilGoal, StreakState } from '../lib/streak';
import { useTranslation } from '../i18n/I18nContext';
import ReportBugButton from './ReportBugButton';
import { getQuantaProfile, type QuantaProfile, type QuantaAwardResult } from '../lib/quanta';
import { getQuantaBalance, getReferralInfo, buildInviteLink, type QuantaBalance } from '../lib/lyceumApi';
import Confetti from './Confetti';
import { useToolDock } from '../context/ToolDockContext';

// ── Dock items ──────────────────────────────────────────────────────────
const DOCK_ITEMS: { view: View; labelKey: string; icon: string }[] = [
  { view: 'problem-sets',  labelKey: 'nav.problemSets',   icon: 'library_books' },
  { view: 'notes',         labelKey: 'nav.notes',          icon: 'edit_note' },
  { view: 'mistake-bank',  labelKey: 'nav.mistakeVault',  icon: 'error_outline' },
  // { view: 'reference-bank', label: 'Reference Bank', icon: 'auto_stories' },  // disabled, coming soon
  { view: 'progress',      labelKey: 'nav.progress',       icon: 'bar_chart' },
];

/** One pool of the Quanta wallet as a bar: remaining vs monthly allowance. */
function WalletBar({ label, remaining, allowance, color }: { label: string; remaining: number; allowance: number; color: string }) {
  const pct = allowance > 0 ? Math.max(0, Math.min(100, Math.round((remaining / allowance) * 100))) : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] text-white/70">{label}</span>
        <span className="text-[11px] font-semibold text-white/60">{remaining.toLocaleString()} ⚡</span>
      </div>
      <div className="h-1.5 w-full bg-white/5 overflow-hidden rounded-full">
        <div className="h-full transition-all duration-500 rounded-full" style={{ width: `${pct}%`, background: color, opacity: 0.85 }} />
      </div>
      <p className="text-[9px] text-white/30 mt-0.5 text-right">
        {remaining.toLocaleString()} / {allowance.toLocaleString()} Quanta
      </p>
    </div>
  );
}

/** Invite friends → +5 Quanta per friend who joins. Copies a share link. */
function InviteRow() {
  const [code, setCode] = useState('');
  const [invited, setInvited] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getReferralInfo().then(info => { setCode(info.code); setInvited(info.invited_count); }).catch(() => {});
  }, []);

  async function handleShare() {
    if (!code) return;
    const link = buildInviteLink(code);
    const text = `Join me on The Lyceum — my invite link: ${link}`;
    try {
      if (navigator.share) { await navigator.share({ title: 'The Lyceum', text, url: link }); return; }
    } catch { /* cancelled */ }
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true); setTimeout(() => setCopied(false), 1600);
    } catch { /* ignore */ }
  }

  return (
    <div className="border-t border-white/10 pt-3 flex items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-[11px] text-white/70">Invite friends</p>
        <p className="text-[9px] text-white/35">+5 Quanta per friend · {invited} joined</p>
      </div>
      <button
        onClick={handleShare}
        disabled={!code}
        className="glass-btn rounded-lg px-3 py-1.5 text-[10px] uppercase tracking-[2px] shrink-0 disabled:opacity-30"
      >
        {copied ? 'Copied!' : 'Share'}
      </button>
    </div>
  );
}

/** Glassy chess-piece streak badge: pawn while chasing the goal date, king once reached. */
function StreakPanel({ state, onClose }: { state: StreakState; onClose: () => void }) {
  const { t } = useTranslation();
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
            <div className="text-lg font-semibold text-white/90">{t('dock.dayStreak', { count: state.streakCount })}</div>
            <div className="text-[10px] uppercase tracking-wider text-white/40">{t('dock.longest', { count: state.longestStreak })}</div>
          </div>
        </div>
        <div className="border-t border-white/10 pt-3">
          <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1">
            {state.goalAchieved ? t('dock.goalReached') : t('dock.target')}
          </div>
          <div className="text-xs text-white/70">{state.goalLabel || t('dock.studyGoal')}</div>
          <div className="text-[10px] text-white/40 mt-0.5">
            {state.goalDate}{!state.goalAchieved && (remaining >= 0 ? ` — ${remaining}d left` : ' — passed')}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Quanta popover: wallet bars (this replaces the old usage panel), level
 * progress, invite-a-friend, and a short activity feed. 1 Quanta = 5 tokens. */
function QuantaPanel({ profile, onClose }: { profile: QuantaProfile; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [balance, setBalance] = useState<QuantaBalance | null>(null);
  const span = profile.points_into_level + profile.points_to_next_level;
  const pct = span > 0 ? Math.min(100, Math.round((profile.points_into_level / span) * 100)) : 0;

  useEffect(() => { getQuantaBalance().then(setBalance).catch(() => {}); }, []);

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
      data-tour="usage-panel"
      className="absolute bottom-full right-0 mb-2 w-72 glass-strong rounded-2xl z-[200] overflow-hidden"
      style={{ animation: 'fadeDown 0.18s ease-out' }}
    >
      <style>{`@keyframes fadeDown { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }`}</style>
      <div className="px-5 py-4 flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <span className="text-[28px] leading-none" style={{ filter: 'drop-shadow(0 0 6px rgba(216,204,255,0.5))' }}>⚡</span>
          <div>
            <div className="text-lg font-semibold text-white/90">Level {profile.level}</div>
            <div className="text-[10px] uppercase tracking-wider text-white/40">
              {profile.total_points} Quanta earned{balance ? ` · ${balance.plan_name}` : ''}
            </div>
          </div>
        </div>
        {balance && (
          <div className="border-t border-white/10 pt-3 flex flex-col gap-3">
            <WalletBar label="Quanta" remaining={balance.standard_remaining} allowance={balance.standard_allowance} color="#fbbf24" />
            <WalletBar label="Coach Quanta" remaining={balance.coach_remaining} allowance={balance.coach_allowance} color="#a78bfa" />
            <p className="text-[9px] text-white/30 text-center">1 Quanta = {balance.tokens_per_quanta} tokens · resets monthly</p>
          </div>
        )}
        <InviteRow />
        <div className="border-t border-white/10 pt-3">
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full rounded-full bg-amber-400" style={{ width: `${pct}%` }} />
          </div>
          <div className="text-[10px] text-white/40 mt-1.5">
            {profile.points_into_level} / {span} to level {profile.level + 1}
          </div>
        </div>
        {profile.recent_events.length > 0 && (
          <div className="border-t border-white/10 pt-3 flex flex-col gap-1.5 max-h-32 overflow-y-auto">
            {profile.recent_events.slice(0, 6).map((e, i) => (
              <div key={i} className="flex items-center justify-between text-[11px] text-white/60">
                <span className="truncate">{e.event_type.replace(/_/g, ' ')}</span>
                <span className="text-amber-300/80 shrink-0 ml-2">+{e.points}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Top-right corner utility capsule: brand mark + usage stats + auth */
function CornerMenu({ onNavigate }: NavigationProps) {
  const { t } = useTranslation();
  const { user, devMode } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { focusActive } = useToolDock();
  const [showStreak, setShowStreak] = useState(false);
  const [streak, setStreak] = useState<StreakState | null>(null);
  const [showQuanta, setShowQuanta] = useState(false);
  const [quanta, setQuanta] = useState<QuantaProfile | null>(null);
  const [levelUp, setLevelUp] = useState(false);

  useEffect(() => { setStreak(recordDailyVisit()); }, []);

  useEffect(() => {
    if (user) getQuantaProfile().then(setQuanta);
  }, [user]);

  useEffect(() => {
    function onAward(e: Event) {
      const detail = (e as CustomEvent<QuantaAwardResult>).detail;
      getQuantaProfile().then(setQuanta);
      if (detail.leveled_up) { setLevelUp(true); setTimeout(() => setLevelUp(false), 1800); }
    }
    window.addEventListener('quanta:awarded', onAward);
    return () => window.removeEventListener('quanta:awarded', onAward);
  }, []);

  async function handleSignOut() {
    try { await signOut(auth); } catch {}
    onNavigate('auth');
  }

  if (focusActive) return null;

  return (
    <div className="fixed top-6 right-6 z-50 flex items-center gap-2">
      <div
        data-tour="corner-brand"
        title={t('nav.lyceum')}
        className="glass rounded-full w-9 h-9 flex items-center justify-center text-white/80 cursor-pointer hover:bg-white/10 hover:text-white transition-colors"
        onClick={() => onNavigate('problem-sets')}
      >
        <span className="material-symbols-outlined text-[18px]">school</span>
      </div>

      {streak && (
        <div className="relative glass rounded-full flex items-center gap-1 px-1.5 py-1.5">
          <button
            data-tour="corner-streak"
            onClick={() => setShowStreak(v => !v)}
            className="h-7 flex items-center gap-1 px-2 rounded-full opacity-70 hover:opacity-100 hover:bg-white/10 transition-all"
            title={t('dock.dayStreak', { count: streak.streakCount })}
          >
            <span className="text-[16px] leading-none">{streak.goalAchieved ? '♚' : '♟'}</span>
            <span className="text-[11px] font-semibold text-white/80">{streak.streakCount}</span>
          </button>
          {showStreak && <StreakPanel state={streak} onClose={() => setShowStreak(false)} />}
        </div>
      )}

      {quanta && (
        <div className="relative glass rounded-full flex items-center gap-1 px-1.5 py-1.5">
          <button
            onClick={() => setShowQuanta(v => !v)}
            className="h-7 flex items-center gap-1 px-2 rounded-full opacity-70 hover:opacity-100 hover:bg-white/10 transition-all"
            title={`Level ${quanta.level} — ${quanta.total_points} Quanta`}
          >
            <span className="text-[16px] leading-none">⚡</span>
            <span className="text-[11px] font-semibold text-white/80">{quanta.level}</span>
          </button>
          {showQuanta && <QuantaPanel profile={quanta} onClose={() => setShowQuanta(false)} />}
        </div>
      )}
      {levelUp && <Confetti />}

      {/* The only entry point into Forum — a paid-plan gated community, not
          a public/invite-code funnel. Reached exclusively from inside the
          workspace on purpose (see ForumPage.tsx / services/forum.py). */}
      <a
        href="/forum"
        className="glass rounded-full w-8 h-8 flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-colors"
        title="Forum"
      >
        <span className="material-symbols-outlined text-[18px]">groups</span>
      </a>

      <div className="relative glass rounded-full flex items-center gap-1 px-1.5 py-1.5">
        <ReportBugButton onNavigate={onNavigate} />

        <button
          onClick={toggleTheme}
          className="w-8 h-8 flex items-center justify-center rounded-full opacity-40 hover:opacity-90 hover:bg-white/10 transition-all"
          title={theme === 'dark' ? t('dock.switchToLight') : t('dock.switchToDark')}
        >
          <span className="material-symbols-outlined text-[16px]">{theme === 'dark' ? 'light_mode' : 'dark_mode'}</span>
        </button>

        <button
          onClick={() => onNavigate('settings')}
          className="w-8 h-8 flex items-center justify-center rounded-full opacity-40 hover:opacity-90 hover:bg-white/10 transition-all"
          title={t('nav.settings')}
        >
          <span className="material-symbols-outlined text-[16px]">settings</span>
        </button>

        {user ? (
          <button
            onClick={handleSignOut}
            className="w-8 h-8 flex items-center justify-center rounded-full opacity-40 hover:opacity-90 hover:bg-white/10 transition-all"
            title={user.displayName || user.email || t('dock.signOut')}
          >
            <span className="material-symbols-outlined text-[16px]">logout</span>
          </button>
        ) : devMode ? (
          <span className="text-[9px] text-white/30 px-2">{t('dock.dev')}</span>
        ) : (
          <button
            onClick={() => onNavigate('auth')}
            className="w-8 h-8 flex items-center justify-center rounded-full opacity-40 hover:opacity-90 hover:bg-white/10 transition-all"
            title={t('dock.signIn')}
          >
            <span className="material-symbols-outlined text-[16px]">login</span>
          </button>
        )}
      </div>
    </div>
  );
}

export default function FloatingDock({ currentView, onNavigate }: NavigationProps) {
  const { t } = useTranslation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { focusActive } = useToolDock();

  // Smaller than ToolDock's icons on purpose (see ToolDock.tsx's w-10 h-10 —
  // this bar is the app-level nav, the tool rail is the workspace's main
  // instrument, so it stays visually a step bigger) and same drag-handle
  // collapse pattern, persisted separately from the tool rail.
  const [navHidden, setNavHidden] = useState(() => {
    try { return localStorage.getItem('lyceum_floatingdock_hidden') === '1'; } catch { return false; }
  });
  function toggleNavHidden() {
    setNavHidden(v => {
      try { localStorage.setItem('lyceum_floatingdock_hidden', v ? '0' : '1'); } catch { /* ignore */ }
      return !v;
    });
  }

  return (
    <>
      <CornerMenu currentView={currentView} onNavigate={onNavigate} />

      {!focusActive && navHidden && (
        <button
          onClick={toggleNavHidden}
          className="hidden md:flex fixed bottom-0 left-1/2 -translate-x-1/2 z-50 items-center justify-center w-14 h-4 rounded-t-xl bg-white/5 hover:bg-white/10 text-white/30 hover:text-white/60 transition-colors"
          title="Hiện thanh điều hướng"
        >
          <span className="material-symbols-outlined text-[14px]">expand_less</span>
        </button>
      )}

      {/* Desktop floating dock — bottom center, visionOS style — hidden
          while a tool has taken over the screen, same as CornerMenu. */}
      {!focusActive && !navHidden && (
      <div className="hidden md:flex flex-col items-center fixed bottom-6 left-1/2 -translate-x-1/2 z-50 gap-0.5">
        <div
          onClick={toggleNavHidden}
          className="cursor-pointer text-white/20 hover:text-white/50 transition-colors"
          title="Bấm để ẩn thanh điều hướng"
        >
          <span className="material-symbols-outlined text-[14px]">drag_indicator</span>
        </div>
      <nav className="flex dock rounded-3xl px-3 py-2.5 items-end gap-1">
        {DOCK_ITEMS.map(({ view, labelKey, icon }) => {
          const active = currentView === view;
          return (
            <button
              key={view}
              data-tour={`dock-${view}`}
              onClick={() => onNavigate(view)}
              className="dock-icon group relative flex flex-col items-center justify-center w-9 h-9 rounded-2xl"
              title={t(labelKey)}
            >
              <span
                className="material-symbols-outlined text-[18px] transition-colors"
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
                {t(labelKey)}
              </span>
            </button>
          );
        })}
      </nav>
      </div>
      )}

      {/* Mobile: compact bottom bar + expandable sheet — same focus-mode hiding */}
      {!focusActive && (
      <div className="md:hidden fixed bottom-4 left-4 right-4 z-50">
        <div className="dock rounded-2xl flex items-center justify-between px-4 py-3">
          <span className="text-xs uppercase tracking-widest text-white/70">
            {DOCK_ITEMS.find(i => i.view === currentView)
              ? t(DOCK_ITEMS.find(i => i.view === currentView)!.labelKey)
              : t('nav.lyceum')}
          </span>
          <button onClick={() => setMobileOpen(v => !v)} className="opacity-70">
            <span className="material-symbols-outlined text-[20px]">{mobileOpen ? 'close' : 'apps'}</span>
          </button>
        </div>
        {mobileOpen && (
          <div className="dock rounded-2xl mt-2 grid grid-cols-3 gap-1 p-2">
            {DOCK_ITEMS.map(({ view, labelKey, icon }) => (
              <button
                key={view}
                onClick={() => { onNavigate(view); setMobileOpen(false); }}
                className={`flex flex-col items-center gap-1 rounded-xl py-3 transition-colors ${
                  currentView === view ? 'bg-white/10 text-white' : 'text-white/50'
                }`}
              >
                <span className="material-symbols-outlined text-[20px]">{icon}</span>
                <span className="text-[8px] uppercase tracking-wide">{t(labelKey)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      )}
    </>
  );
}
