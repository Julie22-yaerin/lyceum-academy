import React, { useState, useRef } from 'react';
import type { View } from '../types';

interface TaskItem {
  view: View;
  label: string;
  emoji: string;
}

const AVAILABLE_TASKS: TaskItem[] = [
  { view: 'notes', label: 'Study Notes', emoji: '📝' },
  { view: 'problem-sets', label: 'Problem Sets', emoji: '📚' },
  { view: 'dialogue', label: 'Socratic Dialogue', emoji: '💬' },
  { view: 'knowledge-map', label: 'Knowledge Map', emoji: '🧠' },
  { view: 'progress', label: 'Progress Review', emoji: '📊' },
  { view: 'exercise', label: 'Current Thesis', emoji: '🎯' },
  { view: 'mistake-bank', label: 'Mistake Bank', emoji: '⚠️' },
  { view: 'community', label: 'Community', emoji: '🤝' },
];

const KEY = 'lyceum_task_config';

export interface TaskConfig {
  tasks: { view: View; label: string; emoji: string; percent: number }[];
}

export function loadTaskConfig(): TaskConfig | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveTaskConfig(config: TaskConfig) {
  try {
    localStorage.setItem(KEY, JSON.stringify(config));
  } catch { /* quota */ }
}

export function loadTodayMinutes(): number | null {
  try {
    const raw = localStorage.getItem('lyceum_today_minutes');
    const day = localStorage.getItem('lyceum_today_date');
    const today = new Date().toDateString();
    if (day !== today) return null;
    return raw ? parseInt(raw, 10) : null;
  } catch {
    return null;
  }
}

export function saveTodayMinutes(minutes: number) {
  try {
    localStorage.setItem('lyceum_today_minutes', String(minutes));
    localStorage.setItem('lyceum_today_date', new Date().toDateString());
  } catch { /* quota */ }
}

export function clearTodayMinutes() {
  try {
    localStorage.removeItem('lyceum_today_minutes');
    localStorage.removeItem('lyceum_today_date');
  } catch { /* quota */ }
}

export function loadBreakMinutes(): number {
  try {
    const raw = localStorage.getItem('lyceum_break_minutes');
    return raw ? parseInt(raw, 10) : 10;
  } catch {
    return 10;
  }
}

export function saveBreakMinutes(minutes: number) {
  try {
    localStorage.setItem('lyceum_break_minutes', String(minutes));
  } catch { /* quota */ }
}

export default function TaskSetupModal({ onClose }: { onClose: () => void }) {
  const [tasks, setTasks] = useState<TaskItem[]>(() => {
    const saved = loadTaskConfig();
    if (saved?.tasks.length) {
      return saved.tasks.map(t => ({
        view: t.view as View,
        label: t.label,
        emoji: t.emoji,
      }));
    }
    return [...AVAILABLE_TASKS];
  });

  const [percents, setPercents] = useState<Record<string, number>>(() => {
    const saved = loadTaskConfig();
    if (saved?.tasks.length) {
      const map: Record<string, number> = {};
      for (const t of saved.tasks) map[t.view] = t.percent;
      return map;
    }
    const even = Math.floor(100 / tasks.length);
    const map: Record<string, number> = {};
    tasks.forEach((t, i) => {
      map[t.view] = i === tasks.length - 1 ? 100 - even * (tasks.length - 1) : even;
    });
    return map;
  });

  const dragIdx = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const total = (Object.values(percents) as number[]).reduce((a, b) => a + b, 0);
  const valid = total === 100 && tasks.length > 0;

  function handleDragStart(index: number) {
    dragIdx.current = index;
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    setDragOverIdx(index);
  }

  function handleDrop(index: number) {
    if (dragIdx.current === null || dragIdx.current === index) {
      setDragOverIdx(null);
      dragIdx.current = null;
      return;
    }
    const copy = [...tasks];
    const [removed] = copy.splice(dragIdx.current, 1);
    copy.splice(index, 0, removed);
    setTasks(copy);
    setDragOverIdx(null);
    dragIdx.current = null;
  }

  function handlePercentChange(view: string, value: number) {
    const clamped = Math.max(0, Math.min(100, value));
    setPercents(p => ({ ...p, [view]: clamped }));
  }

  function handleSave() {
    if (!valid) return;
    const config: TaskConfig = {
      tasks: tasks.map(t => ({
        view: t.view,
        label: t.label,
        emoji: t.emoji,
        percent: percents[t.view] || 0,
      })),
    };
    saveTaskConfig(config);
    onClose();
  }

  function handleSkip() {
    saveTaskConfig({ tasks: [] });
    onClose();
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Georgia, serif',
    }}>
      <style>{`
        @keyframes scaleIn { from { opacity:0; transform:scale(0.96); } to { opacity:1; transform:scale(1); } }
        .ts-enter { animation: scaleIn 0.28s cubic-bezier(0.23,1,0.32,1); }
        .ts-drag { opacity: 0.5; }
        .ts-over { border-top: 2px solid rgba(167,139,250,0.5); }
      `}</style>

      <div className="ts-enter" style={{
        background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(40px)', borderRadius: 16, width: '92vw', maxWidth: 620,
        maxHeight: '88vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
      }}>
        <div style={{ padding: '20px 28px 0', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <span style={{ fontFamily: 'sans-serif', fontSize: 9, letterSpacing: 4, textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)' }}>
              The Lyceum — Task Setup
            </span>
            <button onClick={handleSkip} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'sans-serif', fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)' }}>
              Skip
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 28px 20px' }}>
          <h2 style={{ fontSize: 20, fontWeight: 400, lineHeight: 1.4, marginBottom: 6, color: 'rgba(255,255,255,0.9)' }}>
            Set up your study chain
          </h2>
          <p style={{ fontFamily: 'sans-serif', fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 20, lineHeight: 1.5 }}>
            Drag to reorder your study flow. Set what % of your time each task gets.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {tasks.map((task, i) => (
              <div
                key={task.view}
                draggable
                onDragStart={() => handleDragStart(i)}
                onDragOver={(e) => handleDragOver(e, i)}
                onDragLeave={() => setDragOverIdx(null)}
                onDrop={() => handleDrop(i)}
                onDragEnd={() => { setDragOverIdx(null); dragIdx.current = null; }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 16px', borderRadius: 12,
                  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                  cursor: 'grab', transition: 'all 0.15s',
                  borderTop: dragOverIdx === i ? '2px solid rgba(167,139,250,0.5)' : '1px solid rgba(255,255,255,0.1)',
                  opacity: dragIdx.current === i ? 0.5 : 1,
                }}
              >
                <span style={{ fontFamily: 'sans-serif', fontSize: 11, color: 'rgba(255,255,255,0.25)', minWidth: 20 }}>{i + 1}.</span>
                <span style={{ fontSize: 20, flexShrink: 0 }}>{task.emoji}</span>
                <span style={{ fontFamily: 'sans-serif', fontSize: 13, color: 'rgba(255,255,255,0.75)', flex: 1 }}>{task.label}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={percents[task.view] || 0}
                    onChange={(e) => handlePercentChange(task.view, parseInt(e.target.value, 10) || 0)}
                    style={{
                      width: 52, padding: '6px 8px', borderRadius: 8,
                      border: '1px solid rgba(255,255,255,0.15)',
                      fontFamily: 'sans-serif', fontSize: 13, textAlign: 'center',
                      outline: 'none', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.8)',
                    }}
                  />
                  <span style={{ fontFamily: 'sans-serif', fontSize: 12, color: 'rgba(255,255,255,0.35)', minWidth: 16 }}>%</span>
                </div>
              </div>
            ))}
          </div>

          <div style={{
            marginTop: 14, fontFamily: 'sans-serif', fontSize: 12,
            color: total === 100 ? 'rgba(255,255,255,0.45)' : '#DC2626',
            textAlign: 'right',
          }}>
            Total: {total}% {total !== 100 && '(must be 100%)'}
          </div>
        </div>

        <div style={{ padding: '16px 28px 20px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={handleSkip} style={{
            padding: '10px 24px', background: 'transparent', border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 8, cursor: 'pointer', fontFamily: 'sans-serif', fontSize: 10,
            letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)',
          }}>
            Skip
          </button>
          <button onClick={handleSave} disabled={!valid} style={{
            padding: '10px 28px', background: valid ? 'rgba(167,139,250,0.8)' : 'rgba(255,255,255,0.08)',
            border: 'none', borderRadius: 8, cursor: valid ? 'pointer' : 'not-allowed',
            fontFamily: 'sans-serif', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase',
            color: valid ? '#f0f0f5' : 'rgba(255,255,255,0.25)', fontWeight: 700,
          }}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
