/**
 * OnboardingModal — shown once after first login.
 * Flow: Chat advisor → Learning style sliders (10) → Persona selection (pick 3) → Goal date → Pricing recommendation.
 *
 * Persistence:
 *   localStorage 'lyceum_onboarding_done'   — boolean, hides modal on next visit
 *   localStorage 'lyceum_plan'              — chosen plan id
 *   localStorage 'lyceum_learning_style'    — 10 slider values
 *   localStorage 'lyceum_selected_personas' — top 3 persona IDs
 */

import { useState, useEffect, useRef, useMemo, type DragEvent } from 'react';
import { analyzeOnboarding, chatMessage, fetchPersonas, type ChatMsg, type Persona } from '../lib/api';
import { saveOnboardingAnswers, saveLearningStyle, saveSelectedPersonas } from '../lib/persist';
import { startStreakGoal } from '../lib/streak';

// ── Chat-driven interview config ────────────────────────────────────────────
// The advisor gathers the same 8 signals the old multiple-choice form did
// (q1..q8, same keys downstream code already reads — see lib/api.ts
// generateRoadmap and lib/persist.ts loadOnboardingAnswers) but through
// natural conversation instead of buttons/checkboxes.

const ONBOARDING_SYSTEM_PROMPT = `You are the Lyceum's admissions advisor — warm, curious, and Socratic: you ask one thoughtful question at a time and let the student's answer shape your next question, rather than reading off a script.

Your job in this conversation is to get to know a new student well enough to recommend a study plan. Weave these eight things into the conversation naturally, in whatever order fits the dialogue (don't announce them as a checklist, don't number your questions):
  1. Their main learning goal (e.g. passing the class, a high GPA, research, self-study beyond the curriculum)
  2. What they're studying (their field/subject)
  3. Roughly how many hours a week they study
  4. How many subjects they juggle at once
  5. What frustrates them most about studying right now
  6. Roughly how much material they upload/review per week (readings, PDFs, lecture videos)
  7. How they like to learn (exploring broadly, being guided step by step, having their thinking challenged, wanting a framework to boost grades, discussion with multiple perspectives, etc.)
  8. What they spend most of their study time on (theory, exercises, projects, papers, exam review)

Keep replies short — 2-4 sentences, at most one question per turn. Mirror the student's language (reply in Vietnamese if they write in Vietnamese, English if they write in English). Be genuinely curious, not a form with a chat skin.

Once — and only once — you have a confident picture of all eight points, write ONE warm closing sentence thanking them, then on a new line output ONLY this machine-readable block and nothing after it:
[[ONBOARDING_JSON]]
{"q1": "<their main goal, your words>", "q2": "<field of study>", "q3": "<hours/week, e.g. '5-10 hours'>", "q4": "<how many subjects at once>", "q5": ["<frustration>", "..."], "q6": ["<material volume note>", "..."], "q7": ["<learning-style tag>", "..."], "q8": ["<time-spend note>", "..."]}
[[/ONBOARDING_JSON]]
Do not emit that block until you're actually done — keep the conversation going (at least 4-5 of your turns) until you genuinely have all eight signals.`;

const OPENING_MESSAGE = "Hi — I'm your Lyceum advisor. Before we set up your workspace, I'd love to understand how you study, so let's just talk it through instead of a quiz. To start: what's pulling you to study right now — chasing a high GPA, prepping for research, just trying to pass the class, or something more self-driven?";

const JSON_START = '[[ONBOARDING_JSON]]';
const JSON_END = '[[/ONBOARDING_JSON]]';

// ── Pricing plans (client-side display config) ──────────────────────────────

interface Plan {
  id: string; name: string; price: number; emoji: string;
  tagline: string; color: string; features: string[]; flagship?: boolean;
}

const PLANS: Plan[] = [
  {
    id: 'compass', name: 'Compass', price: 9.99, emoji: '🌱', color: '#4A7C59',
    tagline: '"I feel lost."',
    features: ['Personalized study roadmap', 'Basic Neural Map', 'Progress tracking', 'Weekly planner'],
  },
  {
    id: 'scholar', name: 'Scholar', price: 19.99, emoji: '🎓', color: '#C5A059',
    tagline: 'Flagship — 80% users', flagship: true,
    features: ['AI grading (Meta + Gemma)', 'Full Neural Map', 'Roadmap', 'AI discussion', 'Reflection', 'Planner'],
  },
  {
    id: 'builder', name: 'Builder', price: 24.99, emoji: '🚀', color: '#2563EB',
    tagline: '"Learn to build."',
    features: ['Skill roadmap', 'Project roadmap', 'Learning dependency graph', 'AI mentor', '+ Everything in Scholar'],
  },
  {
    id: 'polymath', name: 'Polymath', price: 34.99, emoji: '🧠', color: '#7C3AED',
    tagline: '"A second brain."',
    features: ['Cross-domain Neural Map', 'Long-term memory', 'Multi-subject planning', 'Advanced knowledge graph', '+ Everything in Scholar'],
  },
  {
    id: 'research', name: 'Research', price: 39.99, emoji: '🔬', color: '#DC2626',
    tagline: '"Papers, theses, research."',
    features: ['Paper analysis', 'Figure explanation', 'Citation map', 'Literature comparison', '+ Everything in Scholar'],
  },
];

// ── PayPal loader ────────────────────────────────────────────────────────────

const PAYPAL_CLIENT_ID = (import.meta as any).env?.VITE_PAYPAL_CLIENT_ID || '';

function loadPayPalScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).paypal) { resolve(); return; }
    const s = document.createElement('script');
    s.src = `https://www.paypal.com/sdk/js?client-id=${PAYPAL_CLIENT_ID}&currency=USD&intent=capture&components=buttons`;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('PayPal SDK failed to load'));
    document.head.appendChild(s);
  });
}

// ── Sub-components ───────────────────────────────────────────────────────────

function PayPalButtons({ plan, onSuccess }: { plan: Plan; onSuccess: (planId: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const rendered = useRef(false);

  useEffect(() => {
    if (!PAYPAL_CLIENT_ID || PAYPAL_CLIENT_ID === 'YOUR_PAYPAL_SANDBOX_CLIENT_ID') {
      setError('PayPal Client ID is not configured. Add VITE_PAYPAL_CLIENT_ID to .env');
      return;
    }
    loadPayPalScript()
      .then(() => setReady(true))
      .catch(() => setError('Failed to load the PayPal SDK.'));
  }, []);

  useEffect(() => {
    if (!ready || !containerRef.current || rendered.current) return;
    rendered.current = true;
    const pp = (window as any).paypal;
    pp.Buttons({
      style: { layout: 'vertical', color: 'gold', shape: 'rect', label: 'pay', height: 40 },
      createOrder: (_data: any, actions: any) => {
        return actions.order.create({
          purchase_units: [{ amount: { value: plan.price.toFixed(2) }, description: `Lyceum ${plan.name} — Monthly` }],
        });
      },
      onApprove: async (_data: any, actions: any) => {
        await actions.order.capture();
        onSuccess(plan.id);
      },
      onError: (err: any) => {
        console.error('PayPal error', err);
        setError('Payment failed. Please try again.');
      },
    }).render(containerRef.current);
  }, [ready]);

  if (error) return <p style={{ fontFamily: 'sans-serif', fontSize: 10, color: 'rgba(220,38,38,0.8)', padding: '6px 0', lineHeight: 1.5 }}>{error}</p>;
  if (!ready) return <div style={{ height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ fontFamily: 'sans-serif', fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(0,0,0,0.35)' }}>Loading…</span></div>;
  return <div ref={containerRef} />;
}

function PlanCard({
  plan, recommended, isAlt, onSelect, selected, onSuccess,
}: {
  plan: Plan; recommended: boolean; isAlt: boolean; onSelect: () => void;
  selected: boolean; onSuccess: (planId: string) => void;
}) {
  const dim = !recommended && !isAlt;
  return (
    <div
      onClick={onSelect}
      style={{
        border: `2px solid ${recommended ? plan.color : isAlt ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.08)'}`,
        borderRadius: 6,
        padding: '18px 20px',
        background: recommended ? `${plan.color}08` : 'white',
        opacity: dim ? 0.35 : 1,
        cursor: 'pointer',
        transition: 'all 0.2s',
        position: 'relative',
        transform: recommended ? 'scale(1.02)' : 'scale(1)',
        boxShadow: recommended ? `0 4px 24px ${plan.color}28` : 'none',
        flex: '0 0 auto',
        width: 210,
        flexShrink: 0,
      }}
    >
      {recommended && (
        <div style={{
          position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)',
          background: plan.color, color: 'white', fontFamily: 'sans-serif',
          fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', padding: '2px 10px',
          borderRadius: 10, whiteSpace: 'nowrap',
        }}>✦ Recommended for you</div>
      )}
      {isAlt && !recommended && (
        <div style={{
          position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.5)', color: 'white', fontFamily: 'sans-serif',
          fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', padding: '2px 8px',
          borderRadius: 10, whiteSpace: 'nowrap',
        }}>Also a good fit</div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 22 }}>{plan.emoji}</span>
        <span style={{ fontFamily: 'Georgia, serif', fontSize: 17, fontWeight: 400, color: 'rgba(0,0,0,0.85)' }}>{plan.name}</span>
        {plan.flagship && (
          <span style={{ fontFamily: 'sans-serif', fontSize: 8, letterSpacing: 1, textTransform: 'uppercase', background: plan.color, color: 'white', padding: '1px 6px', borderRadius: 2 }}>★ Best</span>
        )}
      </div>

      <div style={{ fontFamily: 'Georgia, serif', fontSize: 22, fontWeight: 700, color: plan.color, marginBottom: 2 }}>
        ${plan.price}<span style={{ fontSize: 12, fontWeight: 400, color: 'rgba(0,0,0,0.4)' }}>/month</span>
      </div>
      <p style={{ fontFamily: 'sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.5)', margin: '0 0 12px 0', fontStyle: 'italic' }}>{plan.tagline}</p>

      <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px 0', display: 'flex', flexDirection: 'column', gap: 5 }}>
        {plan.features.map(f => (
          <li key={f} style={{ fontFamily: 'sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-start', gap: 5 }}>
            <span style={{ color: plan.color, flexShrink: 0 }}>✓</span>{f}
          </li>
        ))}
      </ul>

      {selected && (
        <div style={{ marginTop: 4 }}>
          <PayPalButtons plan={plan} onSuccess={onSuccess} />
        </div>
      )}

      {!selected && (
        <div style={{
          width: '100%', padding: '8px 0', border: `1.5px solid ${plan.color}60`,
          borderRadius: 4, fontFamily: 'sans-serif', fontSize: 10,
          letterSpacing: 2, textTransform: 'uppercase', textAlign: 'center',
          color: plan.color, background: 'transparent',
        }}>
          Choose this plan
        </div>
      )}
    </div>
  );
}

// ── Goal-date calendar (shown once the advisor interview is done) ──────────
// Lets the student mark a deadline or upcoming exam as their study target;
// this date is what the streak feature (lib/streak.ts) counts toward — a
// glass pawn per day, a glass king once the streak reaches this date.

const WEEKDAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function GoalCalendar({ selected, onSelect }: { selected: string | null; onSelect: (iso: string) => void }) {
  const today = useMemo(() => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; }, []);
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));

  const weeks = useMemo(() => {
    const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const startOffset = (firstOfMonth.getDay() + 6) % 7; // Monday-first
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const cells: (Date | null)[] = [...Array(startOffset).fill(null)];
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(cursor.getFullYear(), cursor.getMonth(), d));
    while (cells.length % 7 !== 0) cells.push(null);
    const rows: (Date | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    return rows;
  }, [cursor]);

  return (
    <div style={{ background: 'rgba(255,255,255,0.55)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, padding: '16px 18px', boxShadow: '0 4px 18px rgba(0,0,0,0.06)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <button onClick={() => setCursor(c => new Date(c.getFullYear(), c.getMonth() - 1, 1))}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'rgba(0,0,0,0.4)', padding: '4px 8px' }}>‹</button>
        <span style={{ fontFamily: 'sans-serif', fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(0,0,0,0.6)' }}>
          {cursor.toLocaleString('en-US', { month: 'long', year: 'numeric' })}
        </span>
        <button onClick={() => setCursor(c => new Date(c.getFullYear(), c.getMonth() + 1, 1))}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'rgba(0,0,0,0.4)', padding: '4px 8px' }}>›</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4 }}>
        {WEEKDAY_LABELS.map((w, i) => (
          <div key={i} style={{ textAlign: 'center', fontFamily: 'sans-serif', fontSize: 9, color: 'rgba(0,0,0,0.35)' }}>{w}</div>
        ))}
      </div>

      {weeks.map((row, ri) => (
        <div key={ri} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4 }}>
          {row.map((date, ci) => {
            if (!date) return <div key={ci} />;
            const iso = toISODate(date);
            const isPast = date < today;
            const isToday = iso === toISODate(today);
            const isSelected = iso === selected;
            return (
              <button
                key={ci}
                disabled={isPast}
                onClick={() => onSelect(iso)}
                style={{
                  aspectRatio: '1', border: isSelected ? '1.5px solid #C5A059' : isToday ? '1px solid rgba(197,160,89,0.5)' : '1px solid transparent',
                  borderRadius: 8, cursor: isPast ? 'default' : 'pointer',
                  background: isSelected ? '#C5A059' : 'transparent',
                  color: isPast ? 'rgba(0,0,0,0.2)' : isSelected ? 'white' : 'rgba(0,0,0,0.75)',
                  fontFamily: 'sans-serif', fontSize: 12, fontWeight: isSelected ? 700 : 400,
                  transition: 'all 0.15s',
                }}
              >
                {date.getDate()}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── Learning Style Sliders ───────────────────────────────────────────────
// 10 sliders that map to persona cognitive indices.

const SLIDER_CONFIG = [
  { key: 'visual',       label: 'Hình ảnh & Trực quan',    left: 'Text-based',    right: 'Visual thinker' },
  { key: 'exploration',  label: 'Khám phá',                 left: 'Guided steps',  right: 'Self-explore' },
  { key: 'concrete',     label: 'Thực hành',                left: 'Theory first',  right: 'Hands-on' },
  { key: 'pace',         label: 'Tốc độ',                   left: 'Slow & deep',   right: 'Fast & broad' },
  { key: 'challenge',    label: 'Thử thách',                left: 'Gentle',        right: 'Push me hard' },
  { key: 'depth',        label: 'Chiều sâu',                left: 'Overview',      right: 'Deep mastery' },
  { key: 'structure',    label: 'Cấu trúc',                 left: 'Flexible',      right: 'Structured' },
  { key: 'practice',     label: 'Luyện tập',                left: 'Conceptual',    right: 'Drill practice' },
  { key: 'ai_proactive', label: 'AI chủ động',              left: 'AI hands-off',  right: 'AI guides me' },
  { key: 'critique',     label: 'Phê bình tư duy',          left: 'Supportive',    right: 'Challenge me' },
];

function LearningStyleSliders({
  value,
  onChange,
}: {
  value: Record<string, number>;
  onChange: (v: Record<string, number>) => void;
}) {
  return (
    <div className="ob-enter" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ textAlign: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 40, display: 'block', marginBottom: 8 }}>🧠</span>
        <p style={{ fontSize: 18, margin: '0 0 6px', color: 'rgba(0,0,0,0.85)' }}>What's your brain's fav?</p>
        <p style={{ fontFamily: 'sans-serif', fontSize: 12.5, color: 'rgba(0,0,0,0.5)', margin: 0, lineHeight: 1.6 }}>
          Drag each bar toward the style you prefer. This helps us pair you with the right AI study partner.
        </p>
      </div>

      {SLIDER_CONFIG.map(s => (
        <div key={s.key}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontFamily: 'sans-serif', fontSize: 12, color: 'rgba(0,0,0,0.7)', fontWeight: 500 }}>{s.label}</span>
            <span style={{ fontFamily: 'sans-serif', fontSize: 10, color: '#C5A059', fontWeight: 700 }}>{value[s.key] ?? 50}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: 'sans-serif', fontSize: 9, color: 'rgba(0,0,0,0.35)', width: 70, textAlign: 'right', flexShrink: 0 }}>{s.left}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={value[s.key] ?? 50}
              onChange={e => onChange({ ...value, [s.key]: Number(e.target.value) })}
              style={{
                flex: 1, height: 4, appearance: 'none', WebkitAppearance: 'none',
                background: `linear-gradient(to right, #C5A059 0%, #C5A059 ${value[s.key] ?? 50}%, rgba(0,0,0,0.12) ${value[s.key] ?? 50}%, rgba(0,0,0,0.12) 100%)`,
                borderRadius: 2, outline: 'none', cursor: 'pointer',
              }}
            />
            <span style={{ fontFamily: 'sans-serif', fontSize: 9, color: 'rgba(0,0,0,0.35)', width: 70, flexShrink: 0 }}>{s.right}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Persona Selection (ranked list with drag-to-reorder) ────────────────
// Shows all 9 personas ranked by match %, user drags to pick top 3.

function PersonaSelection({
  personas,
  learningStyle,
  selected,
  onReorder,
}: {
  personas: Persona[];
  learningStyle: Record<string, number>;
  selected: string[];
  onReorder: (ids: string[]) => void;
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  // Compute match % for each persona using cosine similarity
  const ranked = useMemo(() => {
    const SLIDER_TO_INDEX: Record<string, string> = {
      visual: 'Visual', exploration: 'Guidance', concrete: 'Experiment',
      pace: 'Pace', challenge: 'Challenge', depth: 'Depth',
      structure: 'Structure', practice: 'Practice', ai_proactive: 'Support', critique: 'Socratic',
    };
    const INVERTED = new Set(['exploration']);

    const userVec = Object.entries(SLIDER_TO_INDEX).map(([key, _]) => {
      let val = learningStyle[key] ?? 50;
      if (INVERTED.has(key)) val = 100 - val;
      return val;
    });

    return personas.map(p => {
      const pVec = Object.values(SLIDER_TO_INDEX).map(idx => (p.cognitive_indices?.[idx] ?? 50));
      const dot = userVec.reduce((s, v, i) => s + v * pVec[i], 0);
      const magA = Math.sqrt(userVec.reduce((s, v) => s + v * v, 0));
      const magB = Math.sqrt(pVec.reduce((s, v) => s + v * v, 0));
      const matchPct = magA && magB ? Math.round((dot / (magA * magB)) * 100) : 50;
      return { ...p, match_pct: matchPct };
    }).sort((a, b) => b.match_pct - a.match_pct);
  }, [personas, learningStyle]);

  // Selected set for quick lookup
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  // Drag handlers
  function handleDragStart(e: DragEvent, idx: number) {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
  }

  function handleDragOver(e: DragEvent, idx: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setOverIdx(idx);
  }

  function handleDrop(e: DragEvent, dropIdx: number) {
    e.preventDefault();
    if (dragIdx === null || dragIdx === dropIdx) return;
    const newRanked = [...ranked];
    const [moved] = newRanked.splice(dragIdx, 1);
    newRanked.splice(dropIdx, 0, moved);
    // Rebuild selected from new order: keep top 3 from reordered list
    const newSelected = newRanked.slice(0, 3).map(p => p.id);
    onReorder(newSelected);
    setDragIdx(null);
    setOverIdx(null);
  }

  function handleDragEnd() {
    setDragIdx(null);
    setOverIdx(null);
  }

  function handleClick(id: string) {
    if (selectedSet.has(id)) {
      // Deselect
      onReorder(selected.filter(s => s !== id));
    } else if (selected.length < 3) {
      onReorder([...selected, id]);
    } else {
      // Replace the last selected with this one
      onReorder([...selected.slice(0, 2), id]);
    }
  }

  return (
    <div className="ob-enter" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ textAlign: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 40, display: 'block', marginBottom: 8 }}>🧪</span>
        <p style={{ fontSize: 18, margin: '0 0 6px', color: 'rgba(0,0,0,0.85)' }}>Choose your 3 AI study partners</p>
        <p style={{ fontFamily: 'sans-serif', fontSize: 12.5, color: 'rgba(0,0,0,0.5)', margin: 0, lineHeight: 1.6 }}>
          Ranked by how well they match your style. Drag to reorder, or click to select. Pick exactly 3.
        </p>
      </div>

      {/* Selected badges */}
      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', padding: '8px 0', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
          {selected.map((id, i) => {
            const p = ranked.find(x => x.id === id);
            return p ? (
              <span key={id} style={{
                fontFamily: 'sans-serif', fontSize: 10, padding: '4px 10px', borderRadius: 12,
                background: 'rgba(197,160,89,0.15)', border: '1px solid rgba(197,160,89,0.4)',
                color: '#6b5215', display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <span style={{ fontWeight: 700 }}>#{i + 1}</span> {p.name.split(' ').pop()}
              </span>
            ) : null;
          })}
        </div>
      )}

      {/* Ranked persona list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 380, overflowY: 'auto', padding: '4px 0' }}>
        {ranked.map((p, idx) => {
          const isSelected = selectedSet.has(p.id);
          const selectedRank = selected.indexOf(p.id);
          const isDragging = dragIdx === idx;
          const isOver = overIdx === idx && dragIdx !== idx;
          return (
            <div
              key={p.id}
              draggable
              onDragStart={e => handleDragStart(e, idx)}
              onDragOver={e => handleDragOver(e, idx)}
              onDrop={e => handleDrop(e, idx)}
              onDragEnd={handleDragEnd}
              onClick={() => handleClick(p.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                borderRadius: 8, cursor: 'grab', transition: 'all 0.15s',
                background: isSelected ? 'rgba(197,160,89,0.1)' : 'rgba(255,255,255,0.5)',
                border: isSelected ? '1.5px solid rgba(197,160,89,0.5)' : isOver ? '1.5px solid rgba(197,160,89,0.3)' : '1.5px solid rgba(0,0,0,0.08)',
                opacity: isDragging ? 0.5 : 1,
                transform: isOver ? 'scale(1.01)' : 'scale(1)',
                boxShadow: isSelected ? '0 2px 12px rgba(197,160,89,0.12)' : 'none',
              }}
            >
              {/* Rank badge */}
              <div style={{
                width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'sans-serif', fontSize: 10, fontWeight: 700,
                background: isSelected ? '#C5A059' : 'rgba(0,0,0,0.08)',
                color: isSelected ? 'white' : 'rgba(0,0,0,0.4)',
              }}>
                {idx + 1}
              </div>

              {/* Persona info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontFamily: 'Georgia, serif', fontSize: 13, fontWeight: 600, color: 'rgba(0,0,0,0.85)' }}>{p.name}</span>
                  {selectedRank >= 0 && (
                    <span style={{ fontFamily: 'sans-serif', fontSize: 8, letterSpacing: 1, textTransform: 'uppercase', background: '#C5A059', color: 'white', padding: '1px 5px', borderRadius: 3 }}>
                      #{selectedRank + 1}
                    </span>
                  )}
                </div>
                <div style={{ fontFamily: 'sans-serif', fontSize: 10, color: 'rgba(0,0,0,0.45)', marginTop: 1 }}>
                  {p.field} · {p.special_trait}
                </div>
              </div>

              {/* Match % */}
              <div style={{
                fontFamily: 'sans-serif', fontSize: 13, fontWeight: 700,
                color: p.match_pct >= 80 ? '#16a34a' : p.match_pct >= 60 ? '#C5A059' : 'rgba(0,0,0,0.35)',
                flexShrink: 0, minWidth: 36, textAlign: 'right',
              }}>
                {p.match_pct}%
              </div>

              {/* Drag handle */}
              <div style={{ flexShrink: 0, color: 'rgba(0,0,0,0.2)', fontSize: 14, cursor: 'grab', userSelect: 'none' }}>
                ⠿
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function OnboardingModal({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<'chat' | 'sliders' | 'personas' | 'goal' | 'pricing'>('chat');
  const [turns, setTurns] = useState<ChatMsg[]>([
    { role: 'system', content: ONBOARDING_SYSTEM_PROMPT },
    { role: 'assistant', content: OPENING_MESSAGE },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState('');
  const [pendingAnswers, setPendingAnswers] = useState<Record<string, string | string[]> | null>(null);
  const [goalDate, setGoalDate] = useState<string | null>(null);
  const [goalLabel, setGoalLabel] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [aiResult, setAiResult] = useState<{
    recommended_plan_id?: string;
    reasoning?: string;
    alternatives?: { plan_id: string; reason: string }[];
  } | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);

  // ── New state for sliders + personas ──────────────────────────────────────
  const [learningStyle, setLearningStyle] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    SLIDER_CONFIG.forEach(s => { init[s.key] = 50; });
    return init;
  });
  const [allPersonas, setAllPersonas] = useState<Persona[]>([]);
  const [selectedPersonaIds, setSelectedPersonaIds] = useState<string[]>([]);
  const [loadingPersonas, setLoadingPersonas] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Fetch personas when entering the sliders phase
  useEffect(() => {
    if (phase === 'sliders' && allPersonas.length === 0) {
      setLoadingPersonas(true);
      fetchPersonas()
        .then(setAllPersonas)
        .catch(() => {})
        .finally(() => setLoadingPersonas(false));
    }
  }, [phase, allPersonas.length]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [turns, sending]);

  async function finishChat(parsedAnswers: Record<string, string | string[]>) {
    // Persist raw answers — the roadmap generator and personalization
    // profile read these later (learning-style q7, study-intensity q1/q3).
    saveOnboardingAnswers(parsedAnswers);
    // Go to sliders next
    setPhase('sliders');
  }

  async function triggerPricing() {
    if (!pendingAnswers) return;
    setPhase('pricing');
    setAnalyzing(true);
    saveLearningStyle(learningStyle);
    saveSelectedPersonas(selectedPersonaIds);
    try {
      const result = await analyzeOnboarding(pendingAnswers, learningStyle, selectedPersonaIds);
      setAiResult(result);
      if (result.recommended_plan_id) setSelectedPlan(result.recommended_plan_id);
    } catch {
      setAiResult({});
    } finally {
      setAnalyzing(false);
    }
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    setChatError('');
    const nextTurns: ChatMsg[] = [...turns, { role: 'user', content: text }];
    setTurns(nextTurns);
    setSending(true);
    try {
      const { reply } = await chatMessage(nextTurns);
      const startIdx = reply.indexOf(JSON_START);
      if (startIdx === -1) {
        setTurns(t => [...t, { role: 'assistant', content: reply }]);
        return;
      }
      const visible = reply.slice(0, startIdx).trim();
      const endIdx = reply.indexOf(JSON_END);
      const jsonStr = reply.slice(startIdx + JSON_START.length, endIdx !== -1 ? endIdx : undefined).trim();
      setTurns(t => [...t, { role: 'assistant', content: visible || "Thank you — let's find your plan." }]);
      let parsed: Record<string, string | string[]> = {};
      try { parsed = JSON.parse(jsonStr); } catch { /* malformed — treat as not-yet-done */ }
      if (Object.keys(parsed).length > 0) {
        setPendingAnswers(parsed);
        finishChat(parsed);
      }
    } catch (e: any) {
      setChatError(e?.message || 'Something went wrong — please try again.');
    } finally {
      setSending(false);
    }
  }

  function confirmGoal() {
    if (!goalDate || !pendingAnswers) return;
    startStreakGoal(goalDate, goalLabel.trim());
    triggerPricing();
  }

  function handlePaySuccess(planId: string) {
    localStorage.setItem('lyceum_onboarding_done', '1');
    localStorage.setItem('lyceum_plan', planId);
    setPaid(true);
    setTimeout(onClose, 2200);
  }

  function handleSkip() {
    localStorage.setItem('lyceum_onboarding_done', '1');
    onClose();
  }

  const recPlan = PLANS.find(p => p.id === aiResult?.recommended_plan_id);
  const altIds  = (aiResult?.alternatives || []).map(a => a.plan_id);

  const userTurnCount = turns.filter(t => t.role === 'user').length;
  const progress =
    phase === 'pricing'  ? 1 :
    phase === 'goal'     ? 0.92 :
    phase === 'personas' ? 0.72 :
    phase === 'sliders'  ? 0.52 :
    Math.min(userTurnCount / 6, 0.42);

  const phaseLabel =
    phase === 'chat'     ? 'The Lyceum — Talk to your advisor' :
    phase === 'sliders'  ? "The Lyceum — What's your brain's fav?" :
    phase === 'personas' ? 'The Lyceum — Choose your partners' :
    phase === 'goal'     ? 'The Lyceum — Set your target' :
                           'The Lyceum — Plans for you';

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: '#050508',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Georgia, serif',
    }}>
      <style>{`
        @keyframes fadeSlideIn { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
        @keyframes scaleIn { from { opacity:0; transform:scale(0.96); } to { opacity:1; transform:scale(1); } }
        .ob-enter { animation: fadeSlideIn 0.22s ease-out; }
        .ob-scale { animation: scaleIn 0.28s cubic-bezier(0.23,1,0.32,1); }
        @keyframes obDotBounce { 0%, 80%, 100% { transform: translateY(0); opacity: 0.35; } 40% { transform: translateY(-4px); opacity: 1; } }
        .ob-dot { width: 6px; height: 6px; border-radius: 50%; background: #C5A059; display: inline-block; animation: obDotBounce 1s infinite ease-in-out; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-thumb { background: #ccc; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: #C5A059; border: 2px solid white; box-shadow: 0 1px 4px rgba(0,0,0,0.2); cursor: grab; }
        input[type=range]::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: #C5A059; border: 2px solid white; box-shadow: 0 1px 4px rgba(0,0,0,0.2); cursor: grab; }
      `}</style>

      {/* Modal panel */}
      <div className="ob-scale" style={{
        background: '#FAFAF8', borderRadius: 8, width: '92vw',
        maxWidth: phase === 'pricing' ? 1060 : phase === 'personas' ? 680 : phase === 'goal' ? 460 : 600,
        maxHeight: '88vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 80px rgba(0,0,0,0.35)',
        transition: 'max-width 0.4s cubic-bezier(0.23,1,0.32,1)',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 28px 0', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <span style={{ fontFamily: 'sans-serif', fontSize: 9, letterSpacing: 4, textTransform: 'uppercase', color: 'rgba(0,0,0,0.35)' }}>
              {phaseLabel}
            </span>
            <button onClick={handleSkip} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'sans-serif', fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(0,0,0,0.28)' }}>
              Skip
            </button>
          </div>
          {/* Progress bar */}
          <div style={{ height: 2, background: 'rgba(0,0,0,0.08)', borderRadius: 2, marginBottom: 2 }}>
            <div style={{ height: '100%', background: '#C5A059', borderRadius: 2, width: `${progress * 100}%`, transition: 'width 0.4s ease' }} />
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px 28px' }}>
          {/* ── Success state ── */}
          {paid && (
            <div className="ob-enter" style={{ textAlign: 'center', padding: '40px 0' }}>
              <div style={{ fontSize: 48, marginBottom: 16, color: '#C5A059' }}>✦</div>
              <p style={{ fontSize: 22, marginBottom: 8, color: 'rgba(0,0,0,0.85)' }}>Welcome to The Lyceum</p>
              <p style={{ fontFamily: 'sans-serif', fontSize: 13, color: 'rgba(0,0,0,0.5)' }}>Starting up your study workspace…</p>
            </div>
          )}

          {/* ── Learning Style Sliders screen ── */}
          {!paid && phase === 'sliders' && (
            <LearningStyleSliders value={learningStyle} onChange={setLearningStyle} />
          )}

          {/* ── Persona Selection screen ── */}
          {!paid && phase === 'personas' && (
            loadingPersonas ? (
              <div className="ob-enter" style={{ textAlign: 'center', padding: '48px 0' }}>
                <div style={{ width: 32, height: 32, border: '2px solid rgba(0,0,0,0.12)', borderTop: '2px solid #C5A059', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                <p style={{ fontFamily: 'sans-serif', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', color: 'rgba(0,0,0,0.4)' }}>Loading personas…</p>
              </div>
            ) : (
              <PersonaSelection
                personas={allPersonas}
                learningStyle={learningStyle}
                selected={selectedPersonaIds}
                onReorder={setSelectedPersonaIds}
              />
            )
          )}

          {/* ── Goal-date screen ── */}
          {!paid && phase === 'goal' && (
            <div className="ob-enter">
              <span style={{ fontSize: 40, display: 'block', textAlign: 'center', marginBottom: 8, color: '#C5A059' }}>♟</span>
              <p style={{ fontSize: 18, textAlign: 'center', margin: '0 0 6px', color: 'rgba(0,0,0,0.85)' }}>Pick a target day</p>
              <p style={{ fontFamily: 'sans-serif', fontSize: 12.5, color: 'rgba(0,0,0,0.5)', textAlign: 'center', margin: '0 0 22px', lineHeight: 1.6 }}>
                A deadline, an upcoming exam — anything that gives your studying a finish line. From today, every day you show up earns a glass pawn; reach this day and it becomes a glass king.
              </p>

              <GoalCalendar selected={goalDate} onSelect={setGoalDate} />

              <input
                type="text"
                value={goalLabel}
                onChange={e => setGoalLabel(e.target.value)}
                placeholder="What's this day for? (e.g. Calculus midterm)"
                style={{
                  width: '100%', marginTop: 16, padding: '12px 14px', border: '1.5px solid rgba(0,0,0,0.16)', borderRadius: 8,
                  fontFamily: 'sans-serif', fontSize: 13, color: 'rgba(0,0,0,0.85)', outline: 'none',
                  background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          )}

          {/* ── Pricing screen ── */}
          {!paid && phase === 'pricing' && (
            <div>
              {analyzing ? (
                <div style={{ textAlign: 'center', padding: '48px 0' }}>
                  <div style={{ width: 32, height: 32, border: '2px solid rgba(0,0,0,0.12)', borderTop: '2px solid #C5A059', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
                  <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                  <p style={{ fontFamily: 'sans-serif', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', color: 'rgba(0,0,0,0.4)' }}>Analyzing your answers…</p>
                </div>
              ) : (
                <div className="ob-enter">
                  {/* Selected persona badges */}
                  {selectedPersonaIds.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginBottom: 20 }}>
                      {selectedPersonaIds.map(id => {
                        const p = allPersonas.find(x => x.id === id);
                        return p ? (
                          <span key={id} style={{
                            fontFamily: 'sans-serif', fontSize: 10, padding: '4px 10px', borderRadius: 12,
                            background: 'rgba(197,160,89,0.12)', border: '1px solid rgba(197,160,89,0.3)',
                            color: '#6b5215', display: 'flex', alignItems: 'center', gap: 4,
                          }}>
                            {p.name} · {p.special_trait}
                          </span>
                        ) : null;
                      })}
                    </div>
                  )}

                  {aiResult?.reasoning && (
                    <div style={{ background: 'rgba(197,160,89,0.1)', border: '1px solid rgba(197,160,89,0.35)', borderRadius: 6, padding: '14px 18px', marginBottom: 24 }}>
                      <span style={{ fontFamily: 'sans-serif', fontSize: 9, letterSpacing: 3, textTransform: 'uppercase', color: '#C5A059', display: 'block', marginBottom: 6 }}>AI assessment</span>
                      <p style={{ fontFamily: 'sans-serif', fontSize: 13, color: 'rgba(0,0,0,0.72)', margin: 0, lineHeight: 1.6 }}>{aiResult.reasoning}</p>
                    </div>
                  )}

                  <p style={{ fontFamily: 'sans-serif', fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(0,0,0,0.4)', marginBottom: 18 }}>
                    Choose a plan and pay to get started
                  </p>

                  {/* Plan cards — horizontal scroll on small screens */}
                  <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 10, paddingTop: 14 }}>
                    {PLANS.map(plan => (
                      <PlanCard
                        key={plan.id}
                        plan={plan}
                        recommended={plan.id === aiResult?.recommended_plan_id}
                        isAlt={altIds.includes(plan.id) && plan.id !== aiResult?.recommended_plan_id}
                        selected={selectedPlan === plan.id}
                        onSelect={() => { setSelectedPlan(plan.id === selectedPlan ? null : plan.id); }}
                        onSuccess={handlePaySuccess}
                      />
                    ))}
                  </div>

                  {aiResult?.alternatives && aiResult.alternatives.length > 0 && (
                    <div style={{ marginTop: 16, borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: 14 }}>
                      <span style={{ fontFamily: 'sans-serif', fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(0,0,0,0.35)' }}>Other good fits</span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
                        {aiResult.alternatives.map(alt => {
                          const p = PLANS.find(x => x.id === alt.plan_id);
                          return p ? (
                            <div key={alt.plan_id} style={{ border: '1px solid rgba(0,0,0,0.12)', borderRadius: 4, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span>{p.emoji}</span>
                              <span style={{ fontFamily: 'sans-serif', fontSize: 11, fontWeight: 600 }}>{p.name}</span>
                              <span style={{ fontFamily: 'sans-serif', fontSize: 10, color: 'rgba(0,0,0,0.45)' }}>— {alt.reason}</span>
                            </div>
                          ) : null;
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Advisor chat ── */}
          {!paid && phase === 'chat' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {turns.filter(t => t.role !== 'system').map((t, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: t.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  <div className="ob-enter" style={{
                    maxWidth: '82%',
                    padding: '12px 16px',
                    borderRadius: t.role === 'user' ? '14px 14px 3px 14px' : '14px 14px 14px 3px',
                    background: t.role === 'user' ? 'rgba(197,160,89,0.16)' : 'rgba(255,255,255,0.55)',
                    backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
                    border: t.role === 'user' ? '1px solid rgba(197,160,89,0.4)' : '1px solid rgba(0,0,0,0.08)',
                    boxShadow: '0 4px 18px rgba(0,0,0,0.06)',
                    fontFamily: 'sans-serif', fontSize: 13.5, lineHeight: 1.6,
                    color: t.role === 'user' ? '#6b5215' : 'rgba(0,0,0,0.78)',
                    whiteSpace: 'pre-wrap',
                  }}>
                    {t.content}
                  </div>
                </div>
              ))}
              {sending && (
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <div style={{
                    padding: '12px 16px', borderRadius: '14px 14px 14px 3px',
                    background: 'rgba(255,255,255,0.55)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
                    border: '1px solid rgba(0,0,0,0.08)', display: 'flex', gap: 4, alignItems: 'center',
                  }}>
                    <span className="ob-dot" style={{ animationDelay: '0s' }} />
                    <span className="ob-dot" style={{ animationDelay: '0.15s' }} />
                    <span className="ob-dot" style={{ animationDelay: '0.3s' }} />
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Goal-date confirm footer */}
        {!paid && phase === 'goal' && (
          <div style={{ flexShrink: 0, padding: '14px 28px 22px', borderTop: '1px solid rgba(0,0,0,0.06)', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={confirmGoal}
              disabled={!goalDate}
              style={{
                padding: '13px 26px', background: goalDate ? '#C5A059' : 'rgba(0,0,0,0.08)',
                border: 'none', borderRadius: 8, cursor: goalDate ? 'pointer' : 'not-allowed',
                fontFamily: 'sans-serif', fontSize: 11, letterSpacing: 2, textTransform: 'uppercase',
                color: goalDate ? '#1a1a1a' : 'rgba(0,0,0,0.25)', fontWeight: 700,
                transition: 'all 0.15s',
              }}>
              Start my streak
            </button>
          </div>
        )}

        {/* Sliders footer — Next button */}
        {!paid && phase === 'sliders' && (
          <div style={{ flexShrink: 0, padding: '14px 28px 22px', borderTop: '1px solid rgba(0,0,0,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontFamily: 'sans-serif', fontSize: 10, color: 'rgba(0,0,0,0.35)' }}>
              Adjust sliders to match your style
            </span>
            <button
              onClick={() => { saveLearningStyle(learningStyle); setPhase('personas'); }}
              style={{
                padding: '13px 26px', background: '#C5A059',
                border: 'none', borderRadius: 8, cursor: 'pointer',
                fontFamily: 'sans-serif', fontSize: 11, letterSpacing: 2, textTransform: 'uppercase',
                color: '#1a1a1a', fontWeight: 700, transition: 'all 0.15s',
              }}>
              Next
            </button>
          </div>
        )}

        {/* Personas footer — Continue button */}
        {!paid && phase === 'personas' && (
          <div style={{ flexShrink: 0, padding: '14px 28px 22px', borderTop: '1px solid rgba(0,0,0,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontFamily: 'sans-serif', fontSize: 10, color: selectedPersonaIds.length === 3 ? '#16a34a' : 'rgba(0,0,0,0.35)' }}>
              {selectedPersonaIds.length === 3 ? '✓ 3 partners selected' : `${selectedPersonaIds.length}/3 selected — drag or click to choose`}
            </span>
            <button
              onClick={() => setPhase('goal')}
              disabled={selectedPersonaIds.length !== 3}
              style={{
                padding: '13px 26px',
                background: selectedPersonaIds.length === 3 ? '#C5A059' : 'rgba(0,0,0,0.08)',
                border: 'none', borderRadius: 8,
                cursor: selectedPersonaIds.length === 3 ? 'pointer' : 'not-allowed',
                fontFamily: 'sans-serif', fontSize: 11, letterSpacing: 2, textTransform: 'uppercase',
                color: selectedPersonaIds.length === 3 ? '#1a1a1a' : 'rgba(0,0,0,0.25)',
                fontWeight: 700, transition: 'all 0.15s',
              }}>
              Continue
            </button>
          </div>
        )}

        {/* Chat input — the only way to answer during onboarding */}
        {!paid && phase === 'chat' && (
          <div style={{ flexShrink: 0, padding: '14px 28px 22px', borderTop: '1px solid rgba(0,0,0,0.06)' }}>
            {chatError && (
              <p style={{ fontFamily: 'sans-serif', fontSize: 11, color: 'rgba(220,38,38,0.8)', margin: '0 0 8px' }}>{chatError}</p>
            )}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                placeholder="Type your reply…"
                disabled={sending}
                autoFocus
                style={{
                  flex: 1, padding: '13px 16px', border: '1.5px solid rgba(0,0,0,0.16)', borderRadius: 8,
                  fontFamily: 'sans-serif', fontSize: 14, color: 'rgba(0,0,0,0.85)', outline: 'none',
                  background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
                  boxSizing: 'border-box',
                }}
              />
              <button
                onClick={sendMessage}
                disabled={sending || !input.trim()}
                style={{
                  padding: '13px 22px', background: (!sending && input.trim()) ? '#C5A059' : 'rgba(0,0,0,0.08)',
                  border: 'none', borderRadius: 8, cursor: (!sending && input.trim()) ? 'pointer' : 'not-allowed',
                  fontFamily: 'sans-serif', fontSize: 11, letterSpacing: 2, textTransform: 'uppercase',
                  color: (!sending && input.trim()) ? '#1a1a1a' : 'rgba(0,0,0,0.25)', fontWeight: 700, flexShrink: 0,
                  transition: 'all 0.15s',
                }}>
                Send
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
