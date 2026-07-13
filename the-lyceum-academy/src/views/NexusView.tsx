import { useEffect, useState } from 'react';
import { NavigationProps } from '../types';
import { loadProgress } from '../lib/progress';
import { loadMistakes } from '../lib/mistakes';
import { loadOnboardingAnswers, loadTodayStudySubject, SUBJECT_META } from '../lib/persist';
import { generateRoadmap, type RoadmapResult } from '../lib/api';
import { useRoadmapRegenGate } from '../lib/useSubscription';
import { logFeatureUsage } from '../lib/subscriptionApi';
import UpgradePrompt from '../components/UpgradePrompt';

function streakDays(): number {
  const records = loadProgress();
  const days = new Set(records.map(r => new Date(r.date).toDateString()));
  let streak = 0;
  const cursor = new Date();
  while (days.has(cursor.toDateString())) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function StreakPath({ values }: { values: number[] }) {
  const w = 320, h = 90, pad = 8;
  const max = Math.max(...values, 1);
  const points = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2);
    const y = h - pad - (v / max) * (h - pad * 2);
    return `${x},${y}`;
  });
  const d = `M ${points.join(' L ')}`;
  const areaD = `${d} L ${w - pad},${h - pad} L ${pad},${h - pad} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-24">
      <defs>
        <linearGradient id="streakGlow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill="url(#streakGlow)" />
      <path d={d} fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        style={{ filter: 'drop-shadow(0 0 6px rgba(167,139,250,0.6))' }} />
      {points.map((p, i) => {
        const [x, y] = p.split(',').map(Number);
        return <circle key={i} cx={x} cy={y} r="2.5" fill="#e9e4ff" />;
      })}
    </svg>
  );
}

const APPROACH_META: Record<string, { label: string; color: string }> = {
  top_down: { label: 'Top-down', color: '#60A5FA' },
  bottom_up: { label: 'Bottom-up', color: '#4ADE80' },
  just_in_time: { label: 'Just-in-time', color: '#FBBF24' },
};

function StyleBar({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-white/50 w-24 flex-shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[10px] text-white/40 w-9 text-right flex-shrink-0">{pct}%</span>
    </div>
  );
}

/**
 * Learning roadmap — DeepSeek-generated (backend /ai/roadmap), blended
 * across top-down/bottom-up/just-in-time by the student's measured fit.
 * Reasoning takes 1-2 minutes for real, so the loading state says so.
 */
function RoadmapWidget() {
  const [topic, setTopic] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RoadmapResult | null>(null);
  const [error, setError] = useState('');
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);
  const { canUse, limit, used } = useRoadmapRegenGate();

  async function handleGenerate() {
    if (!topic.trim() || loading) return;

    // Check roadmap regen limit
    if (!canUse) {
      setShowUpgradePrompt(true);
      return;
    }

    setLoading(true); setError(''); setResult(null);
    try {
      const answers = loadOnboardingAnswers();
      const r = await generateRoadmap(topic.trim(), answers);
      if (r.error) setError('Could not generate a roadmap — try a more specific topic.');
      else {
        setResult(r);
        // Log roadmap regeneration
        try {
          await logFeatureUsage('roadmap_regen', { topic: topic.trim() });
        } catch (err) {
          console.error('Failed to log roadmap usage:', err);
        }
      }
    } catch (e: any) {
      setError(e.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  const limitText = limit === Infinity ? '' : ` (${used}/${limit} today)`;
  const atLimit = !canUse;

  return (
    <div data-tour="roadmap-widget" className="lg:col-span-3 glass-card rounded-3xl p-6">
      {showUpgradePrompt && (
        <UpgradePrompt
          feature="roadmap"
          onClose={() => setShowUpgradePrompt(false)}
        />
      )}

      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-[10px] uppercase tracking-[2px] text-white/40 mb-1">
            Learning Roadmap{limitText}
          </p>
          <p className="text-xs text-white/30">What to shore up first, and in what order — blended to how you actually learn.</p>
        </div>
        {atLimit && (
          <button
            onClick={() => setShowUpgradePrompt(true)}
            className="px-3 py-1.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-sans uppercase tracking-wider"
          >
            Upgrade
          </button>
        )}
      </div>

      <div className="flex gap-2 mb-5">
        <input
          value={topic}
          onChange={e => setTopic(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleGenerate(); }}
          placeholder="What do you want to learn? e.g. quantum mechanics"
          disabled={loading}
          className="flex-1 glass-input rounded-xl px-4 py-2.5 text-sm text-white outline-none"
        />
        <button
          onClick={handleGenerate}
          disabled={loading || !topic.trim()}
          className="glass-btn rounded-xl px-5 py-2.5 text-[10px] uppercase tracking-[2px] font-semibold disabled:opacity-30 flex items-center gap-2 flex-shrink-0"
        >
          {loading ? <div className="w-3 h-3 border border-current/40 border-t-current rounded-full animate-spin" /> : null}
          {loading ? 'Thinking…' : 'Generate'}
        </button>
      </div>

      {loading && (
        <p className="text-xs text-white/30 mb-4">
          DeepSeek is reasoning through prerequisites and sequencing — this genuinely takes 1-2 minutes for a good roadmap, not a quick lookup.
        </p>
      )}

      {error && <p className="text-xs text-red-300/80 mb-4">{error}</p>}

      {result && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2 max-w-sm">
            <StyleBar label="Top-down" pct={result.learning_style.top_down_pct} color={APPROACH_META.top_down.color} />
            <StyleBar label="Bottom-up" pct={result.learning_style.bottom_up_pct} color={APPROACH_META.bottom_up.color} />
            <StyleBar label="Just-in-time" pct={result.learning_style.just_in_time_pct} color={APPROACH_META.just_in_time.color} />
          </div>

          {result.style_summary && <p className="text-xs text-white/50 italic">{result.style_summary}</p>}

          {result.prerequisites.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-[2px] text-white/40 mb-2">Prerequisites</p>
              <div className="flex flex-wrap gap-2">
                {result.prerequisites.map((p, i) => (
                  <div key={i} className={`rounded-xl px-3 py-2 border ${p.priority === 'required' ? 'border-amber-400/40 bg-amber-400/5' : 'border-white/10 bg-white/[0.03]'}`}>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-xs font-medium text-white/85">{p.name}</span>
                      <span className={`text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded-full ${p.priority === 'required' ? 'text-amber-300 bg-amber-400/10' : 'text-white/30 bg-white/5'}`}>{p.priority}</span>
                    </div>
                    <p className="text-[10px] text-white/40 max-w-[220px]">{p.why}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="text-[10px] uppercase tracking-[2px] text-white/40 mb-2">Sequenced path</p>
            <div className="flex flex-col gap-2">
              {result.roadmap_steps.map(s => {
                const meta = APPROACH_META[s.approach] || APPROACH_META.top_down;
                return (
                  <div key={s.order} className="flex gap-3 rounded-xl bg-white/[0.03] border border-white/5 px-4 py-3">
                    <span className="text-sm font-semibold flex-shrink-0" style={{ color: meta.color }}>{s.order}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm text-white/85">{s.title}</span>
                        <span className="text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ color: meta.color, background: `${meta.color}1a` }}>{meta.label}</span>
                      </div>
                      <p className="text-xs text-white/45 leading-relaxed">{s.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function NexusView({ onNavigate }: NavigationProps) {
  const [todaySubject] = useState(() => loadTodayStudySubject());
  const [streak, setStreak] = useState(0);
  const [weeklyActivity, setWeeklyActivity] = useState<number[]>([]);
  const [mistakeCount, setMistakeCount] = useState(0);

  useEffect(() => {
    setStreak(streakDays());
    setMistakeCount(loadMistakes().length);

    const records = loadProgress();
    const byDay: Record<string, number> = {};
    records.forEach(r => {
      const key = new Date(r.date).toDateString();
      byDay[key] = (byDay[key] || 0) + r.grades.length;
    });
    const days: number[] = [];
    const cursor = new Date();
    cursor.setDate(cursor.getDate() - 6);
    for (let i = 0; i < 7; i++) {
      days.push(byDay[cursor.toDateString()] || 0);
      cursor.setDate(cursor.getDate() + 1);
    }
    setWeeklyActivity(days);
  }, []);

  return (
    <div className="w-full">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-metallic mb-1">The Nexus</h1>
        <p className="text-sm text-white/40">Your research command center.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Problem Sets shortcut */}
        <div className="lg:col-span-2 glass-card rounded-3xl p-6">
          <div className="flex items-center justify-between mb-5">
            <p className="text-[10px] uppercase tracking-[2px] text-white/40">Problem Sets</p>
            <button onClick={() => onNavigate('problem-sets')} className="text-[10px] uppercase tracking-[2px] text-purple-300 hover:text-purple-200 transition-colors">
              Open
            </button>
          </div>
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <span className="material-symbols-outlined text-4xl text-white/15 mb-3">assignment</span>
            <p className="text-sm text-white/30 mb-4">Pick up where you left off, or upload a new set.</p>
            <button onClick={() => onNavigate('problem-sets')} className="glass-btn rounded-full px-5 py-2 text-[10px] uppercase tracking-[2px]">
              Browse Problem Sets
            </button>
          </div>
        </div>

        {/* Weekly streak — neon SVG */}
        <div className="glass-card rounded-3xl p-6 flex flex-col">
          <p className="text-[10px] uppercase tracking-[2px] text-white/40 mb-1">Weekly Streak</p>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-4xl font-bold text-white">{streak}</span>
            <span className="text-xs text-white/40">day{streak === 1 ? '' : 's'} in a row</span>
          </div>
          <StreakPath values={weeklyActivity.length ? weeklyActivity : [0, 0, 0, 0, 0, 0, 0]} />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[10px] text-white/30">{todaySubject ? `Focus: ${SUBJECT_META[todaySubject]?.label ?? todaySubject}` : 'No focus set today'}</span>
            <span className="text-[10px] text-amber-300/80">{mistakeCount} logged mistakes</span>
          </div>
        </div>

        {/* 3D model viewport */}
        <div className="lg:col-span-2 glass-card rounded-3xl p-6 relative overflow-hidden min-h-[280px] flex flex-col">
          <p className="text-[10px] uppercase tracking-[2px] text-white/40 mb-4">Model Viewport</p>
          <div className="flex-1 flex items-center justify-center relative">
            <div className="absolute w-48 h-48 rounded-full bg-gradient-to-tr from-blue-500/10 to-purple-500/10 blur-2xl" />
            <svg viewBox="0 0 200 200" className="w-56 h-56 relative z-10 opacity-90 animate-[spin_24s_linear_infinite]">
              <defs>
                <linearGradient id="molGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#60A5FA" />
                  <stop offset="100%" stopColor="#A78BFA" />
                </linearGradient>
              </defs>
              <g stroke="url(#molGrad)" strokeWidth="1.4" opacity="0.7">
                <line x1="100" y1="40" x2="60" y2="110" />
                <line x1="100" y1="40" x2="140" y2="110" />
                <line x1="60" y1="110" x2="140" y2="110" />
                <line x1="100" y1="40" x2="100" y2="160" />
                <line x1="60" y1="110" x2="100" y2="160" />
                <line x1="140" y1="110" x2="100" y2="160" />
              </g>
              <g>
                <circle cx="100" cy="40" r="9" fill="#60A5FA" opacity="0.85" />
                <circle cx="60" cy="110" r="7" fill="#A78BFA" opacity="0.85" />
                <circle cx="140" cy="110" r="7" fill="#A78BFA" opacity="0.85" />
                <circle cx="100" cy="160" r="9" fill="#22D3EE" opacity="0.85" />
              </g>
            </svg>
          </div>
          <p className="text-[10px] text-white/25 text-center mt-2">Interactive molecule / vector graph viewport — drag to orbit</p>
        </div>

        {/* Quick stats */}
        <div className="glass-card rounded-3xl p-6 flex flex-col gap-4 justify-center">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-[2px] text-white/40">Focus Today</span>
            <span className="text-sm font-semibold text-white">{todaySubject ? (SUBJECT_META[todaySubject]?.icon ?? '') + ' ' + (SUBJECT_META[todaySubject]?.label ?? todaySubject) : '—'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-[2px] text-white/40">Mistake Bank</span>
            <button onClick={() => onNavigate('mistake-bank')} className="text-sm font-semibold text-amber-300 hover:text-amber-200">{mistakeCount}</button>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-[2px] text-white/40">Knowledge Tree</span>
            <button onClick={() => onNavigate('knowledge-map')} className="text-sm font-semibold text-cyan-300 hover:text-cyan-200">Explore →</button>
          </div>
        </div>

        <RoadmapWidget />
      </div>
    </div>
  );
}
