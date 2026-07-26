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

import { useState, useEffect, useRef, useMemo, Fragment, type DragEvent } from 'react';
import { analyzeOnboarding, chatMessage, fetchPersonas, type ChatMsg, type Persona } from '../lib/api';
import { saveOnboardingAnswers, saveLearningStyle, saveSelectedPersonas, scopedGateKey, SUBJECT_META } from '../lib/persist';
import { startStreakGoal } from '../lib/streak';
import { saveSchedule, syncScheduleToServer, type ScheduleBlock } from '../lib/schedule';
import { fetchPublishedWorkspaces, type CatalogWorkspace } from '../lib/coach';
import { joinWorkspace } from '../lib/catalogMembership';
import { selectPlan, addToMyBrain, aiResearchSubject } from '../lib/lyceumApi';
import { useWorkspace } from '../context/WorkspaceContext';
import { useTranslation } from '../i18n/I18nContext';
import { detectSubject } from '../lib/persist';
import { setMaterialMode, type MaterialMode } from '../lib/subjectMaterialMode';

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

// ── Plans (Quanta-denominated — the old USD tier set is retired) ────────────
// Static fallback mirrors backend app/services/plans.py; the live catalog is
// fetched at the pricing phase. No USD prices are shown or computed.

interface Plan {
  id: string; name: string; emoji: string; color: string;
  standardQuanta: number; coachQuanta: number; flagship?: boolean; tagline: string;
}

const PLANS: Plan[] = [
  { id: 'e-lite',  name: 'E-Lite',  emoji: '🌱', color: '#4A7C59', standardQuanta: 800,  coachQuanta: 3000,  tagline: 'A light start for steady learners' },
  { id: 'basic',   name: 'Basic',   emoji: '📘', color: '#3B6EA5', standardQuanta: 1600, coachQuanta: 6000,  tagline: 'Room to study every day' },
  { id: 'plus',    name: 'Plus',    emoji: '✦',  color: '#C5A059', standardQuanta: 2000, coachQuanta: 8000,  flagship: true, tagline: 'The full Lyceum experience' },
  { id: 'intense', name: 'Intense', emoji: '🔥', color: '#7C3AED', standardQuanta: 4000, coachQuanta: 10000, tagline: 'For exam season and beyond' },
];

// Legacy AI-recommendation ids → new plan ids (the analyze endpoint may
// still speak in old tier names).
const LEGACY_PLAN_MAP: Record<string, string> = {
  compass: 'e-lite', scholar: 'basic', mentor: 'plus', researcher: 'intense',
};

function PlanCard({
  plan, recommended, cycle, onChoose, busy,
}: {
  plan: Plan; recommended: boolean; cycle: 'monthly' | 'annual';
  onChoose: (planId: string) => void; busy: boolean;
}) {
  return (
    <div
      style={{
        border: `2px solid ${recommended ? plan.color : 'rgba(0,0,0,0.1)'}`,
        borderRadius: 6, padding: '18px 20px',
        background: recommended ? `${plan.color}08` : 'white',
        transition: 'all 0.2s', position: 'relative',
        transform: recommended ? 'scale(1.02)' : 'scale(1)',
        boxShadow: recommended ? `0 4px 24px ${plan.color}28` : 'none',
        flex: '0 0 auto', width: 210, flexShrink: 0,
      }}
    >
      {recommended && (
        <div style={{
          position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)',
          background: plan.color, color: 'white', fontFamily: 'sans-serif',
          fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', padding: '2px 10px',
          borderRadius: 10, whiteSpace: 'nowrap',
        }}>Recommended</div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 22 }}>{plan.emoji}</span>
        <span style={{ fontFamily: 'Georgia, serif', fontSize: 17, color: 'rgba(0,0,0,0.85)' }}>{plan.name}</span>
        {plan.flagship && (
          <span style={{ fontFamily: 'sans-serif', fontSize: 8, letterSpacing: 1, textTransform: 'uppercase', background: plan.color, color: 'white', padding: '1px 6px', borderRadius: 2 }}>Best</span>
        )}
      </div>

      <div style={{ fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 700, color: plan.color, marginBottom: 2 }}>
        ⚡ {plan.standardQuanta.toLocaleString()}
        <span style={{ fontSize: 11, fontWeight: 400, color: 'rgba(0,0,0,0.4)' }}> Quanta/mo</span>
      </div>
      <p style={{ fontFamily: 'sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.55)', margin: '0 0 4px' }}>
        🧭 {plan.coachQuanta.toLocaleString()} Coach Quanta/mo
      </p>
      <p style={{ fontFamily: 'sans-serif', fontSize: 10, color: 'rgba(0,0,0,0.4)', margin: '0 0 12px' }}>
        Billed {cycle === 'annual' ? 'yearly' : 'monthly'} · 1 Quanta = 5 tokens
      </p>
      <p style={{ fontFamily: 'sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.5)', margin: '0 0 14px', fontStyle: 'italic' }}>{plan.tagline}</p>

      <button
        onClick={() => onChoose(plan.id)}
        disabled={busy}
        style={{
          width: '100%', padding: '9px 0', border: `1.5px solid ${plan.color}`,
          borderRadius: 4, fontFamily: 'sans-serif', fontSize: 10,
          letterSpacing: 2, textTransform: 'uppercase', textAlign: 'center',
          color: recommended ? 'white' : plan.color,
          background: recommended ? plan.color : 'transparent',
          cursor: busy ? 'wait' : 'pointer', fontWeight: 700,
        }}
      >
        {busy ? '…' : 'Choose this plan'}
      </button>
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
    <div style={{ background: 'linear-gradient(145deg, #ffffff, #efece2)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, padding: '16px 18px', boxShadow: '6px 6px 16px rgba(0,0,0,0.08), -4px -4px 12px rgba(255,255,255,0.9), inset 1px 1px 2px rgba(255,255,255,0.8)' }}>
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
  { key: 'visual',       labelKey: 'onboard.sliderVisual',    leftKey: 'onboard.sliderVisualLeft',    rightKey: 'onboard.sliderVisualRight' },
  { key: 'exploration',  labelKey: 'onboard.sliderExploration', leftKey: 'onboard.sliderExplorationLeft', rightKey: 'onboard.sliderExplorationRight' },
  { key: 'concrete',     labelKey: 'onboard.sliderConcrete',   leftKey: 'onboard.sliderConcreteLeft',  rightKey: 'onboard.sliderConcreteRight' },
  { key: 'pace',         labelKey: 'onboard.sliderPace',       leftKey: 'onboard.sliderPaceLeft',      rightKey: 'onboard.sliderPaceRight' },
  { key: 'challenge',    labelKey: 'onboard.sliderChallenge',  leftKey: 'onboard.sliderChallengeLeft',  rightKey: 'onboard.sliderChallengeRight' },
  { key: 'depth',        labelKey: 'onboard.sliderDepth',      leftKey: 'onboard.sliderDepthLeft',     rightKey: 'onboard.sliderDepthRight' },
  { key: 'structure',    labelKey: 'onboard.sliderStructure',  leftKey: 'onboard.sliderStructureLeft',  rightKey: 'onboard.sliderStructureRight' },
  { key: 'practice',     labelKey: 'onboard.sliderPractice',   leftKey: 'onboard.sliderPracticeLeft',  rightKey: 'onboard.sliderPracticeRight' },
  { key: 'ai_proactive', labelKey: 'onboard.sliderAi',         leftKey: 'onboard.sliderAiLeft',        rightKey: 'onboard.sliderAiRight' },
  { key: 'critique',     labelKey: 'onboard.sliderCritique',   leftKey: 'onboard.sliderCritiqueLeft',  rightKey: 'onboard.sliderCritiqueRight' },
];

function LearningStyleSliders({
  value,
  onChange,
  t,
}: {
  value: Record<string, number>;
  onChange: (v: Record<string, number>) => void;
  t: (key: string) => string;
}) {
  return (
    <div className="ob-enter" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ textAlign: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 40, display: 'block', marginBottom: 8 }}>🧠</span>
        <p style={{ fontSize: 18, margin: '0 0 6px', color: 'rgba(0,0,0,0.85)' }}>{t('onboard.favHeading')}</p>
        <p style={{ fontFamily: 'sans-serif', fontSize: 12.5, color: 'rgba(0,0,0,0.5)', margin: 0, lineHeight: 1.6 }}>
          {t('onboard.favDesc')}
        </p>
      </div>

      {SLIDER_CONFIG.map(s => (
        <div key={s.key}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontFamily: 'sans-serif', fontSize: 12, color: 'rgba(0,0,0,0.7)', fontWeight: 500 }}>{t(s.labelKey)}</span>
            <span style={{ fontFamily: 'sans-serif', fontSize: 10, color: '#C5A059', fontWeight: 700 }}>{value[s.key] ?? 50}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: 'sans-serif', fontSize: 9, color: 'rgba(0,0,0,0.35)', width: 70, textAlign: 'right', flexShrink: 0 }}>{t(s.leftKey)}</span>
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
            <span style={{ fontFamily: 'sans-serif', fontSize: 9, color: 'rgba(0,0,0,0.35)', width: 70, flexShrink: 0 }}>{t(s.rightKey)}</span>
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
  t,
}: {
  personas: Persona[];
  learningStyle: Record<string, number>;
  selected: string[];
  onReorder: (ids: string[]) => void;
  t: (key: string) => string;
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
        <p style={{ fontSize: 18, margin: '0 0 6px', color: 'rgba(0,0,0,0.85)' }}>{t('onboard.partnersHeading')}</p>
        <p style={{ fontFamily: 'sans-serif', fontSize: 12.5, color: 'rgba(0,0,0,0.5)', margin: 0, lineHeight: 1.6 }}>
          {t('onboard.partnersDesc')}
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

// ── Workspace Catalog Browser (which admin-curated workspaces to join) ─────
// Replaces the old flat SUBJECT_META picker — students now join workspaces
// admins have already curated (with materials/tools/games attached), rather
// than typing a subject. Becomes the student's initial workspace tabs.

function SubjectSelection({
  selected,
  onToggle,
  t,
}: {
  selected: CatalogWorkspace[];
  onToggle: (ws: CatalogWorkspace) => void;
  t: (key: string) => string;
}) {
  const [workspaces, setWorkspaces] = useState<CatalogWorkspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [customName, setCustomName] = useState('');

  useEffect(() => {
    fetchPublishedWorkspaces()
      .then(r => setWorkspaces(r.workspaces))
      .catch(e => setLoadError(e.message || 'Could not load workspaces.'))
      .finally(() => setLoading(false));
  }, []);

  function addCustomSubject() {
    const name = customName.trim();
    if (!name) return;
    // Not backed by any admin-curated workspace — id is prefixed so
    // handleSubjectsContinue knows to skip joinWorkspace for it (there is
    // no real workspace_id to record). It still flows through the exact
    // same onToggle -> seedTabs path as a curated pick, so it becomes a
    // real workspace tab like any other subject node.
    onToggle({
      id: `custom-${Date.now()}`,
      title: name,
      subject_key: detectSubject(name),
      field: '',
      description: null,
      is_published: true,
    });
    setCustomName('');
  }

  return (
    <div className="ob-enter" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ textAlign: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 40, display: 'block', marginBottom: 8 }}>📚</span>
        <p style={{ fontSize: 18, margin: '0 0 6px', color: 'rgba(0,0,0,0.85)' }}>{t('onboard.subjectsHeading')}</p>
        <p style={{ fontFamily: 'sans-serif', fontSize: 12.5, color: 'rgba(0,0,0,0.5)', margin: 0, lineHeight: 1.6 }}>
          Pick the workspaces you want to join — each comes with materials, exercises, and tools already curated for you.
        </p>
      </div>

      {loading && <p style={{ textAlign: 'center', fontFamily: 'sans-serif', fontSize: 12.5, color: 'rgba(0,0,0,0.4)' }}>Loading workspaces…</p>}
      {loadError && <p style={{ textAlign: 'center', fontFamily: 'sans-serif', fontSize: 12.5, color: '#dc2626' }}>{loadError}</p>}
      {!loading && !loadError && workspaces.length === 0 && (
        <p style={{ textAlign: 'center', fontFamily: 'sans-serif', fontSize: 12.5, color: 'rgba(0,0,0,0.4)' }}>No workspaces published yet — check back soon.</p>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', padding: '8px 0' }}>
        {workspaces.map(ws => {
          const meta = SUBJECT_META[ws.subject_key];
          const isSelected = selected.some(s => s.id === ws.id);
          return (
            <button
              key={ws.id}
              onClick={() => onToggle(ws)}
              title={ws.description || undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '10px 16px', borderRadius: 10, cursor: 'pointer',
                background: isSelected ? 'rgba(197,160,89,0.14)' : 'rgba(255,255,255,0.55)',
                border: isSelected ? '1.5px solid rgba(197,160,89,0.55)' : '1.5px solid rgba(0,0,0,0.1)',
                fontFamily: 'sans-serif', fontSize: 13, color: isSelected ? '#6b5215' : 'rgba(0,0,0,0.7)',
                transition: 'all 0.15s',
              }}
            >
              <span style={{ fontSize: 16 }}>{meta?.icon || '📘'}</span>
              {ws.title}
            </button>
          );
        })}
      </div>

      {/* Custom subject nodes — for anything not in the curated catalog.
          Each one becomes its own workspace tab, exactly like a curated
          pick, via the same onToggle -> seedTabs path. */}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'center', padding: '4px 0 8px' }}>
        <input
          value={customName}
          onChange={e => setCustomName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addCustomSubject(); }}
          placeholder="Tạo môn của riêng bạn…"
          style={{
            padding: '9px 14px', borderRadius: 10, minWidth: 200,
            border: '1.5px solid rgba(0,0,0,0.12)', background: 'rgba(255,255,255,0.6)',
            fontFamily: 'sans-serif', fontSize: 12.5, color: 'rgba(0,0,0,0.8)', outline: 'none',
          }}
        />
        <button
          onClick={addCustomSubject}
          disabled={!customName.trim()}
          style={{
            padding: '9px 16px', borderRadius: 10, border: 'none', cursor: customName.trim() ? 'pointer' : 'not-allowed',
            background: customName.trim() ? 'rgba(197,160,89,0.85)' : 'rgba(0,0,0,0.08)',
            fontFamily: 'sans-serif', fontSize: 12, fontWeight: 700,
            color: customName.trim() ? '#1a1a1a' : 'rgba(0,0,0,0.3)',
          }}
        >
          + Thêm
        </button>
      </div>
      {selected.some(s => s.id.startsWith('custom-')) && (
        <p style={{ textAlign: 'center', fontFamily: 'sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.4)', margin: 0 }}>
          Môn tự tạo dùng chung tab với môn gần nhất — không có tài liệu curated sẵn, bạn tự đưa tài liệu vào ở bước tiếp theo.
        </p>
      )}
    </div>
  );
}

// ── Material Source Selection (one mode per subject node) ──────────────────
// Upload / Second Brain / AI Research — see src/lib/subjectMaterialMode.ts
// for what each mode means and which endpoint backs it.

const MATERIAL_MODES: { id: MaterialMode; icon: string; label: string; hint: string }[] = [
  { id: 'upload', icon: '📎', label: 'Upload trước mỗi buổi', hint: 'Miễn phí · cho tài liệu cấp định kỳ' },
  { id: 'second-brain', icon: '🧠', label: 'Second Brain', hint: 'Bạn có sẵn hết tài liệu · tốn Quanta' },
  { id: 'ai-research', icon: '🔎', label: 'AI Research', hint: 'AI tự tổng hợp theo chủ đề · tốn nhiều Quanta' },
];

function MaterialModeCard({ ws, mode, onSetMode }: {
  ws: CatalogWorkspace; mode: MaterialMode | undefined; onSetMode: (subjectKey: string, mode: MaterialMode) => void;
}) {
  const meta = SUBJECT_META[ws.subject_key];
  const [brainContent, setBrainContent] = useState('');
  const [brainBusy, setBrainBusy] = useState(false);
  const [brainDone, setBrainDone] = useState(false);
  const [researchTopic, setResearchTopic] = useState('');
  const [researchBusy, setResearchBusy] = useState(false);
  const [researchDone, setResearchDone] = useState(false);
  const [error, setError] = useState('');

  async function submitSecondBrain() {
    if (!brainContent.trim() || brainBusy) return;
    setBrainBusy(true); setError('');
    try {
      await addToMyBrain(`${ws.title} — tài liệu ban đầu`, brainContent.trim(), ws.subject_key);
      setBrainDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không lưu được — thử lại sau.');
    } finally {
      setBrainBusy(false);
    }
  }

  async function submitResearch() {
    if (!researchTopic.trim() || researchBusy) return;
    setResearchBusy(true); setError('');
    try {
      await aiResearchSubject(ws.subject_key, researchTopic.trim());
      setResearchDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không research được — thử lại sau.');
    } finally {
      setResearchBusy(false);
    }
  }

  return (
    <div style={{ borderRadius: 14, border: '1.5px solid rgba(0,0,0,0.08)', background: 'rgba(255,255,255,0.5)', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={{ margin: 0, fontFamily: 'sans-serif', fontSize: 13, color: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>{meta?.icon || '📘'}</span> {ws.title}
      </p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {MATERIAL_MODES.map(m => (
          <button
            key={m.id}
            onClick={() => onSetMode(ws.subject_key, m.id)}
            title={m.hint}
            style={{
              flex: '1 1 100px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
              padding: '8px 6px', borderRadius: 10, cursor: 'pointer',
              background: mode === m.id ? 'rgba(197,160,89,0.16)' : 'rgba(255,255,255,0.6)',
              border: mode === m.id ? '1.5px solid rgba(197,160,89,0.55)' : '1.5px solid rgba(0,0,0,0.08)',
            }}
          >
            <span style={{ fontSize: 16 }}>{m.icon}</span>
            <span style={{ fontFamily: 'sans-serif', fontSize: 10.5, color: mode === m.id ? '#6b5215' : 'rgba(0,0,0,0.65)', textAlign: 'center' }}>{m.label}</span>
          </button>
        ))}
      </div>

      {mode === 'second-brain' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {brainDone ? (
            <p style={{ margin: 0, fontFamily: 'sans-serif', fontSize: 11.5, color: '#16a34a' }}>✓ Đã lưu vào Second Brain</p>
          ) : (
            <>
              <textarea
                value={brainContent} onChange={e => setBrainContent(e.target.value)}
                placeholder="Dán tài liệu bạn đã có cho môn này…"
                rows={3}
                style={{ resize: 'vertical', padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)', fontFamily: 'sans-serif', fontSize: 12, outline: 'none' }}
              />
              <button onClick={submitSecondBrain} disabled={!brainContent.trim() || brainBusy}
                style={{ alignSelf: 'flex-start', padding: '7px 14px', borderRadius: 8, border: 'none', cursor: brainContent.trim() ? 'pointer' : 'not-allowed', background: brainContent.trim() ? '#C5A059' : 'rgba(0,0,0,0.08)', fontFamily: 'sans-serif', fontSize: 11, fontWeight: 700, color: brainContent.trim() ? '#1a1a1a' : 'rgba(0,0,0,0.3)' }}>
                {brainBusy ? 'Đang xử lý…' : 'Lưu vào Second Brain'}
              </button>
            </>
          )}
        </div>
      )}

      {mode === 'ai-research' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {researchDone ? (
            <p style={{ margin: 0, fontFamily: 'sans-serif', fontSize: 11.5, color: '#16a34a' }}>✓ AI đã research và lưu xong</p>
          ) : (
            <>
              <input
                value={researchTopic} onChange={e => setResearchTopic(e.target.value)}
                placeholder="Chủ đề cụ thể để AI research (vd: Đạo hàm hàm hợp)…"
                style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)', fontFamily: 'sans-serif', fontSize: 12, outline: 'none' }}
              />
              <button onClick={submitResearch} disabled={!researchTopic.trim() || researchBusy}
                style={{ alignSelf: 'flex-start', padding: '7px 14px', borderRadius: 8, border: 'none', cursor: researchTopic.trim() ? 'pointer' : 'not-allowed', background: researchTopic.trim() ? '#C5A059' : 'rgba(0,0,0,0.08)', fontFamily: 'sans-serif', fontSize: 11, fontWeight: 700, color: researchTopic.trim() ? '#1a1a1a' : 'rgba(0,0,0,0.3)' }}>
                {researchBusy ? 'AI đang research…' : 'Research ngay'}
              </button>
            </>
          )}
        </div>
      )}

      {error && <p style={{ margin: 0, fontFamily: 'sans-serif', fontSize: 11, color: '#dc2626' }}>{error}</p>}
    </div>
  );
}

function MaterialModeSelection({ workspaces, modes, onSetMode }: {
  workspaces: CatalogWorkspace[];
  modes: Record<string, MaterialMode>;
  onSetMode: (subjectKey: string, mode: MaterialMode) => void;
}) {
  return (
    <div className="ob-enter" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ textAlign: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 40, display: 'block', marginBottom: 8 }}>🗂️</span>
        <p style={{ fontSize: 18, margin: '0 0 6px', color: 'rgba(0,0,0,0.85)' }}>Tài liệu cho mỗi môn</p>
        <p style={{ fontFamily: 'sans-serif', fontSize: 12.5, color: 'rgba(0,0,0,0.5)', margin: 0, lineHeight: 1.6 }}>
          Chọn một cách cho từng môn — có thể đổi sau trong workspace.
        </p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {workspaces.map(ws => (
          <MaterialModeCard key={ws.id} ws={ws} mode={modes[ws.subject_key]} onSetMode={onSetMode} />
        ))}
      </div>
    </div>
  );
}

// ── Weekly Schedule Picker (drag subject pins onto a day/hour grid) ─────────
// Becomes the ScheduleBlock[] the workspace's ScheduleLockManager later reads
// to ask the AI whether to auto-open/lock a tab for whatever's "live" now.

const SCHEDULE_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SCHEDULE_HOURS = Array.from({ length: 16 }, (_, i) => 6 + i); // 6am–9pm start times

function WeeklySchedulePicker({
  subjectKeys,
  blocks,
  onBlocksChange,
}: {
  subjectKeys: string[];
  blocks: ScheduleBlock[];
  onBlocksChange: (next: ScheduleBlock[]) => void;
}) {
  const [draggingKey, setDraggingKey] = useState<string | null>(null);

  function blockAt(day: number, hour: number) {
    return blocks.find(b => b.dayOfWeek === day && b.startMinute === hour * 60);
  }

  function dropOn(day: number, hour: number) {
    if (!draggingKey) return;
    const startMinute = hour * 60;
    const next = blocks.filter(b => !(b.dayOfWeek === day && b.startMinute === startMinute));
    next.push({ id: `${day}-${startMinute}`, subjectKey: draggingKey, dayOfWeek: day, startMinute, durationMinutes: 60 });
    onBlocksChange(next);
    setDraggingKey(null);
  }

  function removeBlock(id: string) {
    onBlocksChange(blocks.filter(b => b.id !== id));
  }

  return (
    <div className="ob-enter" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ textAlign: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 40, display: 'block', marginBottom: 8 }}>🗓️</span>
        <p style={{ fontSize: 18, margin: '0 0 6px', color: 'rgba(0,0,0,0.85)' }}>When do you want to study?</p>
        <p style={{ fontFamily: 'sans-serif', fontSize: 12.5, color: 'rgba(0,0,0,0.5)', margin: 0, lineHeight: 1.6 }}>
          Drag a subject onto the times you're usually free. Optional — skip if you'd rather stay flexible.
        </p>
      </div>

      {/* Pin tray */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', padding: '4px 0' }}>
        {subjectKeys.map(key => {
          const meta = SUBJECT_META[key];
          if (!meta) return null;
          return (
            <div
              key={key}
              draggable
              onDragStart={() => setDraggingKey(key)}
              onDragEnd={() => setDraggingKey(null)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10,
                cursor: 'grab', fontFamily: 'sans-serif', fontSize: 12,
                background: 'rgba(197,160,89,0.14)', border: '1.5px solid rgba(197,160,89,0.55)', color: '#6b5215',
              }}
            >
              <span>{meta.icon}</span>{meta.label}
            </div>
          );
        })}
      </div>

      {/* Weekly grid */}
      <div style={{ overflowX: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: `44px repeat(7, minmax(64px, 1fr))`, gap: 2, minWidth: 560 }}>
          <div />
          {SCHEDULE_DAYS.map(d => (
            <div key={d} style={{ fontFamily: 'sans-serif', fontSize: 10, textAlign: 'center', color: 'rgba(0,0,0,0.45)', paddingBottom: 4 }}>{d}</div>
          ))}
          {SCHEDULE_HOURS.map(hour => (
            <Fragment key={hour}>
              <div style={{ fontFamily: 'sans-serif', fontSize: 9, color: 'rgba(0,0,0,0.35)', textAlign: 'right', paddingRight: 4, lineHeight: '26px' }}>
                {hour}:00
              </div>
              {SCHEDULE_DAYS.map((_, day) => {
                const block = blockAt(day, hour);
                const meta = block ? SUBJECT_META[block.subjectKey] : null;
                return (
                  <div
                    key={`${day}-${hour}`}
                    onDragOver={e => e.preventDefault()}
                    onDrop={() => dropOn(day, hour)}
                    onClick={() => block && removeBlock(block.id)}
                    title={block ? `${meta?.label} — click to remove` : 'Drop a subject here'}
                    style={{
                      height: 26, borderRadius: 4, cursor: block ? 'pointer' : 'default',
                      background: block ? 'rgba(197,160,89,0.22)' : 'rgba(0,0,0,0.03)',
                      border: block ? '1px solid rgba(197,160,89,0.5)' : '1px dashed rgba(0,0,0,0.08)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, transition: 'background 0.1s',
                    }}
                  >
                    {meta?.icon || ''}
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function OnboardingModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<'chat' | 'subjects' | 'material' | 'schedule' | 'sliders' | 'personas' | 'goal' | 'pricing'>('chat');
  const [selectedWorkspaces, setSelectedWorkspaces] = useState<CatalogWorkspace[]>([]);
  const selectedSubjects = useMemo(() => Array.from(new Set(selectedWorkspaces.map(w => w.subject_key))), [selectedWorkspaces]);
  const [materialModes, setMaterialModes] = useState<Record<string, MaterialMode>>({});
  function setSubjectMaterialMode(subjectKey: string, mode: MaterialMode) {
    setMaterialModes(prev => ({ ...prev, [subjectKey]: mode }));
    setMaterialMode(subjectKey, mode);
  }
  const [scheduleBlocks, setScheduleBlocks] = useState<ScheduleBlock[]>([]);
  const { seedTabs } = useWorkspace();
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
  const [planCycle, setPlanCycle] = useState<'monthly' | 'annual'>('monthly');
  const [planBusy, setPlanBusy] = useState(false);
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
    // Subject selection next — becomes the student's workspace tabs.
    setPhase('subjects');
  }

  function toggleSubject(ws: CatalogWorkspace) {
    setSelectedWorkspaces(prev => prev.some(w => w.id === ws.id) ? prev.filter(w => w.id !== ws.id) : [...prev, ws]);
  }

  function handleSubjectsContinue() {
    if (selectedWorkspaces.length === 0) return;
    seedTabs(selectedSubjects);
    // Custom subject nodes have no real catalog workspace behind them —
    // there is nothing to record a membership id for.
    selectedWorkspaces.filter(ws => !ws.id.startsWith('custom-')).forEach(ws => joinWorkspace(ws.subject_key, ws.id));
    if (pendingAnswers) saveOnboardingAnswers({ ...pendingAnswers, subjects: selectedSubjects });
    setPhase('material');
  }

  function handleMaterialContinue() {
    setPhase('schedule');
  }

  function handleScheduleContinue() {
    saveSchedule(scheduleBlocks);
    void syncScheduleToServer(scheduleBlocks);
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

  // Plan choice completes onboarding — billing is handled later from
  // Settings; no payment gate stands between a new student and the workspace.
  async function handlePlanChosen(planId: string) {
    setPlanBusy(true);
    setSelectedPlan(planId);
    try { await selectPlan(planId, planCycle); } catch { /* offline — plan still stored locally */ }
    localStorage.setItem(scopedGateKey('lyceum_onboarding_done'), '1');
    localStorage.setItem('lyceum_plan', planId);
    setPlanBusy(false);
    setPaid(true);
    setTimeout(onClose, 2200);
  }

  const recommendedPlanId = (() => {
    const raw = aiResult?.recommended_plan_id || '';
    return LEGACY_PLAN_MAP[raw] || (PLANS.some(p => p.id === raw) ? raw : 'plus');
  })();

  const userTurnCount = turns.filter(t => t.role === 'user').length;
  const progress =
    phase === 'pricing'  ? 1 :
    phase === 'goal'     ? 0.92 :
    phase === 'personas' ? 0.72 :
    phase === 'sliders'  ? 0.52 :
    phase === 'schedule' ? 0.48 :
    phase === 'material' ? 0.46 :
    phase === 'subjects' ? 0.44 :
    Math.min(userTurnCount / 6, 0.38);

  const phaseLabel =
    phase === 'chat'     ? t('onboard.talkToAdvisor') :
    phase === 'subjects' ? t('onboard.yourSubjects') :
    phase === 'material' ? 'Tài liệu cho mỗi môn' :
    phase === 'schedule' ? 'Your Weekly Schedule' :
    phase === 'sliders'  ? t('onboard.brainsFav') :
    phase === 'personas' ? t('onboard.choosePartners') :
    phase === 'goal'     ? t('onboard.setTarget') :
                           t('onboard.plansForYou');

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
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
            <span style={{ fontFamily: 'sans-serif', fontSize: 9, letterSpacing: 4, textTransform: 'uppercase', color: 'rgba(0,0,0,0.35)' }}>
              {phaseLabel}
            </span>
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
              <p style={{ fontSize: 22, marginBottom: 8, color: 'rgba(0,0,0,0.85)' }}>{t('onboard.welcomeTitle')}</p>
              <p style={{ fontFamily: 'sans-serif', fontSize: 13, color: 'rgba(0,0,0,0.5)' }}>{t('onboard.startingUp')}</p>
            </div>
          )}

          {/* ── Subject Selection screen ── */}
          {!paid && phase === 'subjects' && (
            <SubjectSelection selected={selectedWorkspaces} onToggle={toggleSubject} t={t} />
          )}

          {/* ── Material Source screen ── */}
          {!paid && phase === 'material' && (
            <MaterialModeSelection workspaces={selectedWorkspaces} modes={materialModes} onSetMode={setSubjectMaterialMode} />
          )}

          {/* ── Weekly Schedule screen ── */}
          {!paid && phase === 'schedule' && (
            <WeeklySchedulePicker subjectKeys={selectedSubjects} blocks={scheduleBlocks} onBlocksChange={setScheduleBlocks} />
          )}

          {/* ── Learning Style Sliders screen ── */}
          {!paid && phase === 'sliders' && (
            <LearningStyleSliders value={learningStyle} onChange={setLearningStyle} t={t} />
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
                  background: 'linear-gradient(145deg, #f0ede4, #fbfaf6)',
                  boxShadow: 'inset 2px 2px 5px rgba(0,0,0,0.08), inset -1px -1px 3px rgba(255,255,255,0.8)',
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

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
                    <p style={{ fontFamily: 'sans-serif', fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(0,0,0,0.4)', margin: 0 }}>
                      Choose your plan — all allowances in Quanta
                    </p>
                    <div style={{ display: 'flex', gap: 2, background: 'rgba(0,0,0,0.06)', borderRadius: 999, padding: 2 }}>
                      {(['monthly', 'annual'] as const).map(c => (
                        <button key={c} onClick={() => setPlanCycle(c)}
                          style={{
                            padding: '4px 12px', borderRadius: 999, border: 'none', cursor: 'pointer',
                            fontFamily: 'sans-serif', fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase',
                            background: planCycle === c ? '#C5A059' : 'transparent',
                            color: planCycle === c ? 'white' : 'rgba(0,0,0,0.45)', fontWeight: 700,
                          }}>
                          {c === 'monthly' ? 'Monthly' : 'Yearly'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Plan cards — horizontal scroll on small screens */}
                  <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 10, paddingTop: 14 }}>
                    {PLANS.map(plan => (
                      <PlanCard
                        key={plan.id}
                        plan={plan}
                        recommended={plan.id === recommendedPlanId}
                        cycle={planCycle}
                        onChoose={handlePlanChosen}
                        busy={planBusy && selectedPlan === plan.id}
                      />
                    ))}
                  </div>

                  <p style={{ fontFamily: 'sans-serif', fontSize: 10, color: 'rgba(0,0,0,0.4)', marginTop: 14 }}>
                    Studying with friends? A <b>Team plan</b> (3 accounts, shared workspace + chat room) is available in Settings after setup.
                    You can also top up extra Quanta credits any time.
                  </p>
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
                    background: t.role === 'user' ? 'linear-gradient(145deg, #f3e8d0, #ecdcb8)' : 'linear-gradient(145deg, #ffffff, #efece2)',
                    border: t.role === 'user' ? '1px solid rgba(197,160,89,0.4)' : '1px solid rgba(0,0,0,0.08)',
                    boxShadow: '5px 5px 14px rgba(0,0,0,0.08), -3px -3px 10px rgba(255,255,255,0.85), inset 1px 1px 2px rgba(255,255,255,0.6)',
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
                    background: 'linear-gradient(145deg, #ffffff, #efece2)',
                    boxShadow: '5px 5px 14px rgba(0,0,0,0.08), -3px -3px 10px rgba(255,255,255,0.85)',
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

        {/* Subjects footer — Continue button */}
        {!paid && phase === 'subjects' && (
          <div style={{ flexShrink: 0, padding: '14px 28px 22px', borderTop: '1px solid rgba(0,0,0,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontFamily: 'sans-serif', fontSize: 10, color: selectedSubjects.length > 0 ? '#16a34a' : 'rgba(0,0,0,0.35)' }}>
              {selectedSubjects.length > 0 ? `✓ ${selectedSubjects.length} selected` : 'Pick at least one'}
            </span>
            <button
              onClick={handleSubjectsContinue}
              disabled={selectedSubjects.length === 0}
              style={{
                padding: '13px 26px',
                background: selectedSubjects.length > 0 ? '#C5A059' : 'rgba(0,0,0,0.08)',
                border: 'none', borderRadius: 8,
                cursor: selectedSubjects.length > 0 ? 'pointer' : 'not-allowed',
                fontFamily: 'sans-serif', fontSize: 11, letterSpacing: 2, textTransform: 'uppercase',
                color: selectedSubjects.length > 0 ? '#1a1a1a' : 'rgba(0,0,0,0.25)',
                fontWeight: 700, transition: 'all 0.15s',
              }}>
              Continue
            </button>
          </div>
        )}

        {/* Material footer — Continue button (a mode is picked per subject, defaults to upload) */}
        {!paid && phase === 'material' && (
          <div style={{ flexShrink: 0, padding: '14px 28px 22px', borderTop: '1px solid rgba(0,0,0,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontFamily: 'sans-serif', fontSize: 10, color: 'rgba(0,0,0,0.35)' }}>
              Không chọn = mặc định Upload trước mỗi buổi
            </span>
            <button
              onClick={handleMaterialContinue}
              style={{
                padding: '13px 26px', background: '#C5A059',
                border: 'none', borderRadius: 8, cursor: 'pointer',
                fontFamily: 'sans-serif', fontSize: 11, letterSpacing: 2, textTransform: 'uppercase',
                color: '#1a1a1a', fontWeight: 700, transition: 'all 0.15s',
              }}>
              Continue
            </button>
          </div>
        )}

        {/* Schedule footer — Continue button (always enabled, schedule is optional) */}
        {!paid && phase === 'schedule' && (
          <div style={{ flexShrink: 0, padding: '14px 28px 22px', borderTop: '1px solid rgba(0,0,0,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontFamily: 'sans-serif', fontSize: 10, color: 'rgba(0,0,0,0.35)' }}>
              {scheduleBlocks.length > 0 ? `${scheduleBlocks.length} block${scheduleBlocks.length === 1 ? '' : 's'} scheduled` : 'Optional — skip if you prefer to stay flexible'}
            </span>
            <button
              onClick={handleScheduleContinue}
              style={{
                padding: '13px 26px', background: '#C5A059',
                border: 'none', borderRadius: 8, cursor: 'pointer',
                fontFamily: 'sans-serif', fontSize: 11, letterSpacing: 2, textTransform: 'uppercase',
                color: '#1a1a1a', fontWeight: 700, transition: 'all 0.15s',
              }}>
              Continue
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
                  background: 'linear-gradient(145deg, #f0ede4, #fbfaf6)',
                  boxShadow: 'inset 2px 2px 5px rgba(0,0,0,0.08), inset -1px -1px 3px rgba(255,255,255,0.8)',
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
