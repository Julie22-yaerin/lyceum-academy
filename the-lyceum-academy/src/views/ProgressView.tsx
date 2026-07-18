import { useState, useEffect } from 'react';
import { loadProgress, clearProgress, GradeRecord } from '../lib/progress';
import { useWorkspace } from '../context/WorkspaceContext';
import { useTranslation } from '../i18n/I18nContext';

// ── Color palette ─────────────────────────────────────────────────────────
const TOPIC_COLORS = [
  '#C5A059', '#4A7C59', '#823B18', '#2563EB',
  '#7C3AED', '#059669', '#DC2626', '#D97706',
  '#0891B2', '#BE185D', '#65A30D', '#6366F1',
];

const DIFF_COLORS: Record<string, string> = {
  easy: '#4A7C59',
  medium: '#C5A059',
  hard: '#823B18',
  extreme: '#7C3AED',
};

// ── SVG pie helpers ────────────────────────────────────────────────────────
function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg - 90) * Math.PI / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arc(cx: number, cy: number, r: number, start: number, end: number) {
  if (end - start >= 359.9) {
    return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`;
  }
  const s = polar(cx, cy, r, start);
  const e = polar(cx, cy, r, end);
  return `M ${cx} ${cy} L ${s.x} ${s.y} A ${r} ${r} 0 ${end - start > 180 ? 1 : 0} 1 ${e.x} ${e.y} Z`;
}

interface Slice { label: string; value: number; color: string; }

function DonutChart({ slices, size = 160, label = '' }: { slices: Slice[]; size?: number; label?: string }) {
  const { t } = useTranslation();
  const cx = size / 2, cy = size / 2, r = size / 2 - 10;
  const total = slices.reduce((s, p) => s + p.value, 0);
  if (total === 0) return <div style={{ width: size, height: size }} className="flex items-center justify-center"><span className="font-sans text-xs opacity-20">{t('progress.noData')}</span></div>;
  let angle = 0;
  const segs = slices.map(s => {
    const deg = (s.value / total) * 360;
    const seg = { ...s, start: angle, end: angle + deg };
    angle += deg;
    return seg;
  });
  return (
    <svg width={size} height={size} className="flex-shrink-0">
      {segs.map((s, i) => (
        <path key={i} d={arc(cx, cy, r, s.start, s.end)} fill={s.color} opacity={0.82} />
      ))}
      <circle cx={cx} cy={cy} r={r * 0.58} fill="var(--surface, #fff)" />
      {label && (
        <>
          <text x={cx} y={cy - 4} textAnchor="middle" fontSize={18} fontFamily="Georgia, serif" fill="currentColor" opacity={0.8}>{label}</text>
          <text x={cx} y={cy + 14} textAnchor="middle" fontSize={9} fontFamily="sans-serif" fill="currentColor" opacity={0.35} letterSpacing={1}>{t('progress.total')}</text>
        </>
      )}
    </svg>
  );
}

// ── Stat card ──────────────────────────────────────────────────────────────
function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border border-outline/10 bg-surface p-5 text-center shadow-sm">
      <p className="font-sans text-[9px] uppercase tracking-[2px] opacity-40 mb-2">{label}</p>
      <p className="font-serif text-3xl text-on-surface">{value}</p>
      {sub && <p className="font-sans text-[9px] opacity-30 mt-1">{sub}</p>}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────
export default function ProgressView() {
  const { t } = useTranslation();
  const { activeTab } = useWorkspace();
  const [records, setRecords] = useState<GradeRecord[]>([]);
  const [showClear, setShowClear] = useState(false);

  useEffect(() => { setRecords(loadProgress(activeTab || undefined)); }, [activeTab]);

  const allGrades = records.flatMap(r => r.grades);
  const totalQs = allGrades.length;
  const totalPassed = allGrades.filter(g => g.passed).length;
  const overallRate = totalQs > 0 ? Math.round((totalPassed / totalQs) * 100) : 0;

  // Topic aggregation
  const topicMap: Record<string, { total: number; passed: number }> = {};
  allGrades.forEach(g => {
    (g.concepts || []).forEach(c => {
      if (!topicMap[c]) topicMap[c] = { total: 0, passed: 0 };
      topicMap[c].total++;
      if (g.passed) topicMap[c].passed++;
    });
  });
  const topics = Object.entries(topicMap)
    .map(([name, { total, passed }]) => ({ name, total, passed, rate: Math.round((passed / total) * 100) }))
    .sort((a, b) => b.total - a.total);

  const masteredCount = topics.filter(t => t.rate >= 70).length;
  const improvingCount = topics.filter(t => t.rate >= 40 && t.rate < 70).length;
  const strugglingCount = topics.filter(t => t.rate < 40).length;
  const topicCoverage = topics.length > 0 ? Math.round((masteredCount / topics.length) * 100) : 0;

  // Difficulty breakdown
  const diffMap: Record<string, { total: number; passed: number }> = {};
  allGrades.forEach(g => {
    const d = g.difficulty || 'medium';
    if (!diffMap[d]) diffMap[d] = { total: 0, passed: 0 };
    diffMap[d].total++;
    if (g.passed) diffMap[d].passed++;
  });

  // Sessions (last 12)
  const sessions = records.slice(-12).map(r => ({
    label: new Date(r.date).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }),
    filename: r.filename.replace(/\.pdf$/i, '').slice(0, 18),
    rate: r.grades.length > 0 ? Math.round(r.grades.filter(g => g.passed).length / r.grades.length * 100) : 0,
    total: r.grades.length,
  }));
  const maxRate = Math.max(...sessions.map(s => s.rate), 100);

  // Mastery pie
  const masterySlices: Slice[] = [
    { label: t('progress.mastered70'), value: masteredCount, color: '#4A7C59' },
    { label: t('progress.improving4069'), value: improvingCount, color: '#C5A059' },
    { label: t('progress.struggling40'), value: strugglingCount, color: '#823B18' },
  ].filter(s => s.value > 0);

  // Topic distribution pie (top 10)
  const topicSlices: Slice[] = topics.slice(0, 10).map((t, i) => ({
    label: t.name,
    value: t.total,
    color: TOPIC_COLORS[i % TOPIC_COLORS.length],
  }));

  // Streak: consecutive recent sessions with rate >= 70
  let streak = 0;
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i];
    const rate = r.grades.length > 0 ? r.grades.filter(g => g.passed).length / r.grades.length : 0;
    if (rate >= 0.7) streak++;
    else break;
  }

  if (totalQs === 0) {
    return (
      <div className="flex-grow flex flex-col items-center justify-center py-20 px-4 bg-surface">
        <span className="material-symbols-outlined text-5xl opacity-15 mb-6">bar_chart</span>
        <h1 className="font-serif text-4xl opacity-30 mb-4">{t('progress.noDataTitle')}</h1>
        <p className="font-sans text-sm opacity-25 text-center max-w-xs">
          {t('progress.noDataDesc')}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-grow flex flex-col items-center py-12 px-4 bg-surface min-h-screen">
      <div className="w-full max-w-4xl">

        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="font-serif text-5xl text-on-surface mb-5 tracking-tight">{t('progress.title')}</h1>
          <p className="font-sans text-sm text-on-surface opacity-50 italic tracking-wide">
            {t('progress.quote')}
          </p>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
          <StatCard label={t('progress.questions')} value={totalQs.toString()} sub={`${totalPassed} ${t('progress.passed')}`} />
          <StatCard label={t('progress.passRate')} value={`${overallRate}%`} sub={`${records.length} ${t('progress.sessions')}`} />
          <StatCard label={t('progress.topicsExplored')} value={topics.length.toString()} sub={`${masteredCount} ${t('progress.mastered')}`} />
          <StatCard label={t('progress.winStreak')} value={streak.toString()} sub={`${t('progress.sessionsGte70')}`} />
        </div>

        {/* Row 1: Mastery donut + Session bar chart */}
        <div className="grid md:grid-cols-2 gap-6 mb-6">

          {/* Mastery donut */}
          <div className="border border-outline/10 shadow-sm p-6">
            <p className="font-sans text-[10px] uppercase tracking-[2px] opacity-40 mb-6">{t('progress.topicMastery')}</p>
            <div className="flex items-center gap-6">
              <DonutChart slices={masterySlices} size={140} label={`${topicCoverage}%`} />
              <div className="flex flex-col gap-3 flex-1">
                {masterySlices.map(s => (
                  <div key={s.label} className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 flex-shrink-0" style={{ background: s.color }} />
                    <span className="font-sans text-[10px] opacity-60 flex-1">{s.label}</span>
                    <span className="font-sans text-[11px] font-semibold opacity-80">{s.value}</span>
                  </div>
                ))}
                <p className="font-sans text-[9px] opacity-25 mt-1 border-t border-outline/10 pt-2">
                  {topicCoverage}% {t('progress.ofTopicsMastered')}
                </p>
              </div>
            </div>
          </div>

          {/* Session performance */}
          <div className="border border-outline/10 shadow-sm p-6">
            <p className="font-sans text-[10px] uppercase tracking-[2px] opacity-40 mb-6">{t('progress.sessionPerf')}</p>
            <div className="flex items-end gap-1.5 h-28 mb-2">
              {sessions.map((s, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative min-w-0">
                  <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 font-sans text-[8px] bg-on-surface text-surface px-1.5 py-0.5 opacity-0 group-hover:opacity-90 transition-opacity whitespace-nowrap pointer-events-none" style={{ borderRadius: 2 }}>
                    {s.rate}% · {s.total}q
                  </div>
                  <div
                    className="w-full transition-all"
                    style={{
                      height: `${Math.max(4, (s.rate / maxRate) * 96)}px`,
                      background: s.rate >= 70 ? '#4A7C59' : s.rate >= 40 ? '#C5A059' : '#823B18',
                      opacity: 0.75,
                    }}
                  />
                </div>
              ))}
            </div>
            <div className="flex items-end gap-1.5">
              {sessions.map((s, i) => (
                <div key={i} className="flex-1 min-w-0 text-center">
                  <span className="font-sans text-[7px] opacity-25 truncate block">{s.label}</span>
                </div>
              ))}
            </div>
            {sessions.length === 0 && <p className="font-sans text-xs opacity-25">{t('progress.noSessions')}</p>}
          </div>
        </div>

        {/* Row 2: Topic distribution pie + Difficulty breakdown */}
        <div className="grid md:grid-cols-2 gap-6 mb-6">

          {/* Topic distribution */}
          {topicSlices.length > 0 && (
            <div className="border border-outline/10 shadow-sm p-6">
              <p className="font-sans text-[10px] uppercase tracking-[2px] opacity-40 mb-6">{t('progress.topicDist')}</p>
              <div className="flex items-center gap-4">
                <DonutChart slices={topicSlices} size={130} />
                <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                  {topicSlices.map(s => (
                    <div key={s.label} className="flex items-center gap-1.5 min-w-0">
                      <span className="w-2 h-2 flex-shrink-0" style={{ background: s.color }} />
                      <span className="font-sans text-[9px] opacity-55 truncate flex-1">{s.label}</span>
                      <span className="font-sans text-[9px] opacity-35 flex-shrink-0">{s.value}q</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Difficulty breakdown */}
          <div className="border border-outline/10 shadow-sm p-6">
            <p className="font-sans text-[10px] uppercase tracking-[2px] opacity-40 mb-6">{t('progress.diffBreakdown')}</p>
            <div className="flex flex-col gap-5">
              {(['easy', 'medium', 'hard', 'extreme'] as const).map(d => {
                const stat = diffMap[d];
                if (!stat) return null;
                const rate = Math.round((stat.passed / stat.total) * 100);
                return (
                  <div key={d}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-sans text-[10px] uppercase tracking-[1px] opacity-55">{d}</span>
                      <span className="font-sans text-[10px] opacity-40">{stat.passed}/{stat.total} · {rate}%</span>
                    </div>
                    <div className="h-1.5 w-full bg-outline-variant/15 relative">
                      <div className="h-full transition-all" style={{ width: `${rate}%`, background: DIFF_COLORS[d] }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Topic table */}
        {topics.length > 0 && (
          <div className="border border-outline/10 shadow-sm mb-10">
            <div className="px-6 py-4 border-b border-outline/10 flex items-center justify-between">
              <p className="font-sans text-[10px] uppercase tracking-[2px] opacity-40">{t('progress.allTopics')}</p>
              <span className="font-sans text-[9px] opacity-25">{topics.length} {t('progress.topicsExplored2')}</span>
            </div>
            <div className="divide-y divide-outline/8">
              {topics.map(topic => {
                const color = topic.rate >= 70 ? '#4A7C59' : topic.rate >= 40 ? '#C5A059' : '#823B18';
                const status = topic.rate >= 70 ? t('progress.statusMastered') : topic.rate >= 40 ? t('progress.statusImproving') : t('progress.statusStruggling');
                return (
                  <div key={topic.name} className="px-6 py-3 flex items-center gap-4 hover:bg-surface-container-highest/30 transition-colors">
                    <span className="font-sans text-sm text-on-surface opacity-75 flex-1 min-w-0 truncate">{topic.name}</span>
                    <span className="font-sans text-[8px] uppercase tracking-[1px] px-2 py-0.5 flex-shrink-0" style={{ color, border: `1px solid ${color}40`, background: `${color}12` }}>{status}</span>
                    <div className="w-20 h-1 bg-outline-variant/15 flex-shrink-0 hidden md:block">
                      <div className="h-full" style={{ width: `${topic.rate}%`, background: color }} />
                    </div>
                    <span className="font-sans text-[10px] opacity-45 w-10 text-right flex-shrink-0">{topic.rate}%</span>
                    <span className="font-sans text-[9px] opacity-25 w-14 text-right flex-shrink-0">{topic.passed}/{topic.total}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Clear */}
        {!showClear ? (
          <div className="flex justify-center pb-6">
            <button onClick={() => setShowClear(true)}
              className="font-sans text-[10px] uppercase tracking-[2px] opacity-20 hover:opacity-50 transition-opacity flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[13px]">delete</span>{t('progress.clearData')}
            </button>
          </div>
        ) : (
          <div className="flex justify-center gap-4 pb-6">
            <button onClick={() => setShowClear(false)} className="font-sans text-[10px] uppercase tracking-[2px] opacity-40 hover:opacity-80 transition-opacity">{t('common.cancel')}</button>
            <button onClick={() => { clearProgress(activeTab || undefined); setRecords([]); setShowClear(false); }}
              className="font-sans text-[10px] uppercase tracking-[2px] text-red-500 hover:text-red-700 transition-colors flex items-center gap-1">
              <span className="material-symbols-outlined text-[12px]">warning</span>{t('progress.confirmClear')}
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
