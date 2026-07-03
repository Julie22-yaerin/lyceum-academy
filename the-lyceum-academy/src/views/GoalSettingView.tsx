import React, { useState, useRef } from 'react';
import type { View } from '../types';
import {
  loadTaskConfig, saveTaskConfig,
  loadTodayMinutes, saveTodayMinutes,
  loadBreakMinutes, saveBreakMinutes,
} from '../components/TaskSetupModal';

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
  { view: 'community', label: 'Community', emoji: '🤝' },
];

export default function GoalSettingView() {
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

  const [breakMinutes, setBreakMinutes] = useState(loadBreakMinutes);
  const [totalMinutes, setTotalMinutes] = useState(() => {
    const existing = loadTodayMinutes();
    return existing !== null ? existing : 60;
  });

  const [saved, setSaved] = useState(false);

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
    const config = {
      tasks: tasks.map(t => ({
        view: t.view,
        label: t.label,
        emoji: t.emoji,
        percent: percents[t.view] || 0,
      })),
    };
    saveTaskConfig(config);
    saveBreakMinutes(breakMinutes);
    saveTodayMinutes(totalMinutes);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-[10px] uppercase tracking-[3px] text-white/40 font-semibold mb-1">
            The Lyceum
          </h1>
          <h2 className="font-serif text-2xl text-white">Goal Setting</h2>
        </div>
        <button
          onClick={handleSave}
          disabled={!valid}
          className={`px-6 py-2.5 text-[10px] uppercase tracking-[2px] font-semibold transition-all ${
            valid
              ? 'glass-btn cursor-pointer'
              : 'glass border-white/10 text-white/25 cursor-not-allowed'
          }`}
        >
          {saved ? 'Saved ✓' : 'Save'}
        </button>
      </div>

      <div className="space-y-10">
        {/* Time allocation */}
        <section>
          <div className="flex items-center gap-3 mb-4">
            <span className="text-lg">⏱</span>
            <div>
              <h3 className="text-sm font-semibold text-white">Time Allocation</h3>
              <p className="text-[11px] text-white/40">
                Drag to reorder. Set what % of your study time each task gets.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2">
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
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                  cursor: 'grab', transition: 'all 0.15s',
                  borderTop: dragOverIdx === i ? '2px solid rgba(167,139,250,0.8)' : '1px solid rgba(255,255,255,0.1)',
                  opacity: dragIdx.current === i ? 0.5 : 1,
                  backdropFilter: 'blur(12px)',
                }}
              >
                <span className="text-[11px] text-white/25 font-mono min-w-[20px]">{i + 1}.</span>
                <span className="text-lg flex-shrink-0">{task.emoji}</span>
                <span className="text-[13px] text-white/75 flex-1">{task.label}</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={percents[task.view] || 0}
                    onChange={(e) => handlePercentChange(task.view, parseInt(e.target.value, 10) || 0)}
                    className="w-[52px] px-2 py-1.5 text-[13px] text-center border border-white/15 rounded-xl outline-none glass-input text-white"
                  />
                  <span className="text-[12px] text-white/35 min-w-[16px]">%</span>
                </div>
              </div>
            ))}
          </div>

          <div className={`mt-3 text-[12px] text-right ${total === 100 ? 'text-white/45' : 'text-red-400'}`}>
            Total: {total}% {total !== 100 && '(must be 100%)'}
          </div>
        </section>

        {/* Break time */}
        <section>
          <div className="flex items-center gap-3 mb-4">
            <span className="text-lg">☕</span>
            <div>
              <h3 className="text-sm font-semibold text-white">Break Time</h3>
              <p className="text-[11px] text-white/40">
                Minutes between each task.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={1}
              max={60}
              value={breakMinutes}
              onChange={(e) => setBreakMinutes(Math.max(1, Math.min(60, parseInt(e.target.value, 10) || 1)))}
              className="w-[80px] px-3 py-2 text-[13px] text-center border border-white/15 rounded-xl outline-none glass-input text-white"
            />
            <span className="text-[12px] text-white/45">minutes</span>
          </div>
        </section>

        {/* Total study time */}
        <section>
          <div className="flex items-center gap-3 mb-4">
            <span className="text-lg">📅</span>
            <div>
              <h3 className="text-sm font-semibold text-white">Daily Study Time</h3>
              <p className="text-[11px] text-white/40">
                Total study time for today (excluding breaks).
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={10}
              max={600}
              value={totalMinutes}
              onChange={(e) => setTotalMinutes(Math.max(10, Math.min(600, parseInt(e.target.value, 10) || 10)))}
              className="w-[80px] px-3 py-2 text-[13px] text-center border border-white/15 rounded-xl outline-none glass-input text-white"
            />
            <span className="text-[12px] text-white/45">minutes</span>
          </div>
        </section>
      </div>
    </div>
  );
}
