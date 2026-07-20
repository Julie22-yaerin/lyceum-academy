import { useState, useEffect, useRef } from 'react';
import { motion, useMotionValue, useSpring, useTransform, AnimatePresence, type MotionValue } from 'motion/react';
import { MessagesSquare, Network, BookOpen, FileText, AlertTriangle, BarChart3, X, Menu } from 'lucide-react';
import { View, NavigationProps } from '../types';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { auth, signOut } from '../lib/firebase';
import { recordDailyVisit, daysUntilGoal, StreakState } from '../lib/streak';
import { useTranslation } from '../i18n/I18nContext';
import ReportBugButton from './ReportBugButton';
import { getCurrentSubscription, getUsageStats, type CurrentSubscription, type UsageStats } from '../lib/subscriptionApi';
import { getQuantaProfile, type QuantaProfile, type QuantaAwardResult } from '../lib/quanta';
import Confetti from './Confetti';

// ── Dock items ──────────────────────────────────────────────────────────
const DOCK_ITEMS: { view: View; labelKey: string; icon: React.ReactNode }[] = [
  { view: 'dialogue',      labelKey: 'nav.dialogue',       icon: <MessagesSquare /> },
  { view: 'knowledge-map', labelKey: 'nav.knowledgeTree', icon: <Network /> },
  { view: 'problem-sets',  labelKey: 'nav.problemSets',   icon: <BookOpen /> },
  { view: 'notes',         labelKey: 'nav.notes',          icon: <FileText /> },
  { view: 'mistake-bank',  labelKey: 'nav.mistakeVault',  icon: <AlertTriangle /> },
  { view: 'progress',      labelKey: 'nav.progress',       icon: <BarChart3 /> },
];

const TIER_LIMITS: Record<string, { voice: number; reference: number; roadmap: number }> = {
  free:       { voice: 0, reference: 0, roadmap: 0 },
  compass:    { voice: 15, reference: 20, roadmap: 1 },
  scholar:    { voice: 60, reference: 100, roadmap: 4 },
  mentor:     { voice: 180, reference: Infinity, roadmap: 7 },
  researcher: { voice: 600, reference: Infinity, roadmap: Infinity },
};

function UsageBar({ label, used, limit, color }: { label: string; used: number; limit: number | null; color: string }) {
  const { t } = useTranslation();
  const isUnlimited = limit === null || limit === Infinity;
  const pct = isUnlimited ? 0 : Math.min((used / limit) * 100, 100);

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] text-white/70">{label}</span>
        <span className="text-[11px] font-semibold text-white/60" style={{ minWidth: 36, textAlign: 'right' }}>
          {isUnlimited ? '∞' : `${pct.toFixed(0)}%`}
        </span>
      </div>
      <div className="h-1.5 w-full bg-white/5 overflow-hidden rounded-full">
        <div
          className="h-full transition-all duration-500 rounded-full"
          style={{
            width: isUnlimited ? '100%' : `${pct}%`,
            background: color,
            opacity: isUnlimited ? 0.3 : 0.85,
          }}
        />
      </div>
      <p className="text-[9px] text-white/30 mt-0.5 text-right">
        {isUnlimited
          ? t('usage.unlimited')
          : t('usage.usedOf', { used: used.toLocaleString(), limit: limit.toLocaleString() })}
      </p>
    </div>
  );
}

function UsagePanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [sub, setSub] = useState<CurrentSubscription | null>(null);
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([
      getCurrentSubscription().catch(() => null),
      getUsageStats().catch(() => null),
    ]).then(([s, u]) => { setSub(s); setUsage(u); setLoading(false); });
  }, []);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const tier = sub?.tier || 'free';
  const limits = TIER_LIMITS[tier] || TIER_LIMITS.free;

  const categories = [
    {
      key: 'voice',
      label: t('usage.voiceAri'),
      icon: 'mic',
      used: usage?.voice_minutes_used ?? 0,
      limit: sub?.voice_minutes_limit ?? limits.voice,
      color: '#FF6B35',
    },
    {
      key: 'reference',
      label: t('usage.referenceLibrary'),
      icon: 'auto_stories',
      used: usage?.reference_library_count ?? 0,
      limit: sub ? (usage?.reference_library_limit ?? limits.reference) : limits.reference,
      color: '#4285F4',
    },
    {
      key: 'roadmap',
      label: t('usage.roadmapRegen'),
      icon: 'route',
      used: usage?.roadmap_regens_today ?? 0,
      limit: usage?.roadmap_regen_daily_limit ?? limits.roadmap,
      color: '#76B900',
    },
  ];

  return (
    <div
      ref={ref}
      data-tour="usage-panel"
      className="absolute bottom-full right-0 mb-2 w-80 glass-strong rounded-2xl z-[200] overflow-hidden"
      style={{ animation: 'fadeDown 0.18s ease-out' }}
    >
      <style>{`@keyframes fadeDown { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }`}</style>

      <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-white/50">{t('dock.usage')}</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/10 text-white/50 uppercase tracking-wide">
            {tier}
          </span>
        </div>
        <button onClick={onClose} className="opacity-30 hover:opacity-80 transition-opacity">
          <X size={14} />
        </button>
      </div>

      <div className="px-5 py-4 flex flex-col gap-4">
        {loading ? (
          <div className="flex items-center gap-3 py-2">
            <div className="w-3 h-3 border border-white/20 border-t-white rounded-full animate-spin" />
            <span className="text-xs text-white/40">{t('common.loading')}</span>
          </div>
        ) : (
          <>
            {categories.map((cat) => (
              <UsageBar
                key={cat.key}
                label={cat.label}
                used={cat.used}
                limit={cat.limit}
                color={cat.color}
              />
            ))}
            <div className="border-t border-white/10 pt-3">
              <p className="text-[9px] text-white/30 text-center">
                {t('usage.billingPeriod', {
                  start: usage?.billing_period_start ?? '—',
                  end: usage?.billing_period_end ?? '—',
                })}
              </p>
            </div>
          </>
        )}
      </div>
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

/** Quanta popover: level, progress to next level, and a short activity feed. */
function QuantaPanel({ profile, onClose }: { profile: QuantaProfile; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const span = profile.points_into_level + profile.points_to_next_level;
  const pct = span > 0 ? Math.min(100, Math.round((profile.points_into_level / span) * 100)) : 0;

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
      className="absolute bottom-full right-0 mb-2 w-64 glass-strong rounded-2xl z-[200] overflow-hidden"
      style={{ animation: 'fadeDown 0.18s ease-out' }}
    >
      <div className="px-5 py-4 flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <span className="text-[28px] leading-none" style={{ filter: 'drop-shadow(0 0 6px rgba(216,204,255,0.5))' }}>⚡</span>
          <div>
            <div className="text-lg font-semibold text-white/90">Level {profile.level}</div>
            <div className="text-[10px] uppercase tracking-wider text-white/40">{profile.total_points} Quanta</div>
          </div>
        </div>
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
  const [showStats, setShowStats] = useState(false);
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

  return (
    <div className="fixed top-6 right-6 z-50 flex items-center gap-2">
      <div
        data-tour="corner-brand"
        className="glass rounded-full px-4 py-2 text-xs font-medium tracking-wider uppercase text-white/80 cursor-pointer hover:bg-white/10 transition-colors"
        onClick={() => onNavigate('problem-sets')}
      >
        {t('nav.lyceum')}
      </div>

      {streak && (
        <div className="relative glass rounded-full flex items-center gap-1 px-1.5 py-1.5">
          <button
            data-tour="corner-streak"
            onClick={() => setShowStreak(v => !v)}
            className="h-8 flex items-center gap-1 px-2 rounded-full opacity-70 hover:opacity-100 hover:bg-white/10 transition-all"
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
            className="h-8 flex items-center gap-1 px-2 rounded-full opacity-70 hover:opacity-100 hover:bg-white/10 transition-all"
            title={`Level ${quanta.level} — ${quanta.total_points} Quanta`}
          >
            <span className="text-[16px] leading-none">⚡</span>
            <span className="text-[11px] font-semibold text-white/80">{quanta.level}</span>
          </button>
          {showQuanta && <QuantaPanel profile={quanta} onClose={() => setShowQuanta(false)} />}
        </div>
      )}
      {levelUp && <Confetti />}

      <div className="relative glass rounded-full flex items-center gap-1 px-1.5 py-1.5">
        <button
          data-tour="corner-usage"
          onClick={() => setShowStats(v => !v)}
          className="w-8 h-8 flex items-center justify-center rounded-full opacity-40 hover:opacity-90 hover:bg-white/10 transition-all"
          title={t('dock.usage')}
        >
          <BarChart3 size={16} />
        </button>
        {showStats && <UsagePanel onClose={() => setShowStats(false)} />}

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

// ── Aceternity-style mouse-tracking dock icon ─────────────────────────────
function DockIcon({
  mouseX,
  view,
  labelKey,
  icon,
  active,
  onNavigate,
}: {
  mouseX: MotionValue;
  view: View;
  labelKey: string;
  icon: React.ReactNode;
  active: boolean;
  onNavigate: (v: View) => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);

  const distance = useTransform(mouseX, (val) => {
    const bounds = ref.current?.getBoundingClientRect() ?? { x: 0, width: 0 };
    return val - bounds.x - bounds.width / 2;
  });

  const widthSync = useTransform(distance, [-150, 0, 150], [48, 72, 48]);
  const heightSync = useTransform(distance, [-150, 0, 150], [48, 72, 48]);
  const iconSync = useTransform(distance, [-150, 0, 150], [20, 28, 20]);

  const width = useSpring(widthSync, { mass: 0.1, stiffness: 150, damping: 12 });
  const height = useSpring(heightSync, { mass: 0.1, stiffness: 150, damping: 12 });
  const iconSize = useSpring(iconSync, { mass: 0.1, stiffness: 150, damping: 12 });

  const [hovered, setHovered] = useState(false);

  return (
    <a href="#" onClick={(e) => { e.preventDefault(); onNavigate(view); }}>
      <motion.div
        ref={ref}
        style={{ width, height }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="relative flex aspect-square items-center justify-center rounded-full"
        data-tour={`dock-${view}`}
      >
        {/* Active glow background */}
        {active && (
          <div className="absolute inset-0 rounded-full bg-violet-500/20" />
        )}

        <AnimatePresence>
          {hovered && (
            <motion.div
              initial={{ opacity: 0, y: 10, x: '-50%' }}
              animate={{ opacity: 1, y: 0, x: '-50%' }}
              exit={{ opacity: 0, y: 2, x: '-50%' }}
              className="absolute -top-10 left-1/2 w-fit glass-strong rounded-lg px-2.5 py-1 text-[10px] whitespace-pre text-white/80 z-10"
            >
              {t(labelKey)}
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div
          style={{ width: iconSize, height: iconSize }}
          className="flex items-center justify-center [&>svg]:w-full [&>svg]:h-full"
        >
          <span style={{ color: active ? '#d8ccff' : 'rgba(255,255,255,0.6)' }}>
            {icon}
          </span>
        </motion.div>

        {/* Active glowing dot */}
        <span
          className="dock-dot absolute -bottom-1.5 w-1 h-1 rounded-full transition-opacity"
          style={{
            background: '#a78bfa',
            color: '#a78bfa',
            opacity: active ? 1 : 0,
          }}
        />
      </motion.div>
    </a>
  );
}

// ── Desktop dock ─────────────────────────────────────────────────────────
function FloatingDockDesktop({
  currentView,
  onNavigate,
}: {
  currentView: View;
  onNavigate: (v: View) => void;
}) {
  const mouseX = useMotionValue(Infinity);

  return (
    <motion.div
      onMouseMove={(e) => mouseX.set(e.pageX)}
      onMouseLeave={() => mouseX.set(Infinity)}
      className="mx-auto hidden md:flex fixed bottom-6 left-1/2 -translate-x-1/2 z-50 dock rounded-3xl px-4 pb-3 pt-3 items-end gap-2"
    >
      {DOCK_ITEMS.map(({ view, labelKey, icon }) => (
        <DockIcon
          key={view}
          mouseX={mouseX}
          view={view}
          labelKey={labelKey}
          icon={icon}
          active={currentView === view}
          onNavigate={onNavigate}
        />
      ))}
    </motion.div>
  );
}

// ── Mobile dock ──────────────────────────────────────────────────────────
function FloatingDockMobile({
  currentView,
  onNavigate,
}: {
  currentView: View;
  onNavigate: (v: View) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden fixed bottom-4 left-4 right-4 z-50">
      <div className="dock rounded-2xl flex items-center justify-between px-4 py-3">
        <span className="text-xs uppercase tracking-widest text-white/70">
          {DOCK_ITEMS.find(i => i.view === currentView)
            ? t(DOCK_ITEMS.find(i => i.view === currentView)!.labelKey)
            : t('nav.lyceum')}
        </span>
        <button onClick={() => setOpen(v => !v)} className="opacity-70 text-white/70">
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="dock rounded-2xl mt-2 grid grid-cols-3 gap-1 p-2"
          >
            {DOCK_ITEMS.map(({ view, labelKey, icon }) => (
              <button
                key={view}
                onClick={() => { onNavigate(view); setOpen(false); }}
                className={`flex flex-col items-center gap-1 rounded-xl py-3 transition-colors ${
                  currentView === view ? 'bg-white/10 text-white' : 'text-white/50'
                }`}
              >
                {icon}
                <span className="text-[8px] uppercase tracking-wide">{t(labelKey)}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Main export ──────────────────────────────────────────────────────────
export default function FloatingDock({ currentView, onNavigate }: NavigationProps) {
  return (
    <>
      <CornerMenu currentView={currentView} onNavigate={onNavigate} />
      <FloatingDockDesktop currentView={currentView} onNavigate={onNavigate} />
      <FloatingDockMobile currentView={currentView} onNavigate={onNavigate} />
    </>
  );
}
