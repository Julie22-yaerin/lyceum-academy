/**
 * WeeklyScheduleSetup — the first thing a new account sees. Replaces the old
 * onboarding questionnaire: no waitlist, no interview, just "when are you
 * actually going to study?"
 *
 * House rules, enforced here rather than suggested:
 *   - At most MAX_PER_DAY sessions on any one day. The cap is the point — an
 *     over-ambitious plan is the usual failure mode for the students this is
 *     built for, so the UI refuses to let them build one.
 *   - A session is a window (from → to). Inside it, StudyCycleTimer runs the
 *     45-on / 5-10-off cycle; this screen only decides *when*, never *how long
 *     to grind*.
 *
 * Persists through the existing lib/schedule.ts store (localStorage +
 * best-effort POST /schedule so the backend can pre-generate exercises).
 */
import { useState } from 'react';
import { CalendarDays, Plus, X } from 'lucide-react';
import { loadSchedule, saveSchedule, syncScheduleToServer, type ScheduleBlock } from '../lib/schedule';
import { SUBJECT_META } from '../lib/persist';
import { LiquidMetalButton } from '../../components/ui/liquid-metal-button';

const MAX_PER_DAY = 3;
const DAYS = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];
// Math & Science only — the scope of the whole platform.
const SUBJECTS = ['math', 'physics', 'chemistry', 'biology'] as const;

function hhmmToMinutes(v: string): number {
  const [h, m] = v.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minutesToHHMM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

let idSeq = 0;
function nextId() { return `blk-${Date.now()}-${idSeq++}`; }

export default function WeeklyScheduleSetup({ onDone }: { onDone: () => void }) {
  const [blocks, setBlocks] = useState<ScheduleBlock[]>(() => loadSchedule());
  // Which day currently has the "add a session" form open, if any.
  const [addingDay, setAddingDay] = useState<number | null>(null);
  const [subject, setSubject] = useState<string>('math');
  const [from, setFrom] = useState('19:00');
  const [to, setTo] = useState('20:30');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const perDay = (day: number) => blocks.filter(b => b.dayOfWeek === day);

  function openAdd(day: number) {
    setAddingDay(day);
    setError('');
  }

  function confirmAdd() {
    if (addingDay === null) return;
    const start = hhmmToMinutes(from);
    const end = hhmmToMinutes(to);
    if (end <= start) {
      setError('Giờ kết thúc phải sau giờ bắt đầu.');
      return;
    }
    if (end - start < 45) {
      setError('Mỗi buổi cần ít nhất 45 phút — đúng một chu kỳ học.');
      return;
    }
    const sameDay = perDay(addingDay);
    if (sameDay.length >= MAX_PER_DAY) {
      setError(`Tối đa ${MAX_PER_DAY} buổi mỗi ngày.`);
      return;
    }
    // Overlapping windows would make "which subject is live now?" ambiguous
    // for ScheduleLockManager, so they're rejected outright.
    const clash = sameDay.some(b => start < b.startMinute + b.durationMinutes && b.startMinute < end);
    if (clash) {
      setError('Buổi này trùng giờ với một buổi khác trong ngày.');
      return;
    }
    setBlocks(prev => [...prev, {
      id: nextId(), subjectKey: subject, dayOfWeek: addingDay,
      startMinute: start, durationMinutes: end - start,
    }]);
    setAddingDay(null);
    setError('');
  }

  function remove(id: string) {
    setBlocks(prev => prev.filter(b => b.id !== id));
  }

  async function finish() {
    if (busy) return;
    setBusy(true);
    saveSchedule(blocks);
    await syncScheduleToServer(blocks);
    onDone();
  }

  return (
    <div className="min-h-screen bg-[#050508] text-slate-200 font-sans antialiased px-4 py-12 flex flex-col items-center">
      <div className="w-full max-w-3xl">
        <div className="text-center mb-8">
          <CalendarDays className="w-8 h-8 text-purple-300 mx-auto mb-3" strokeWidth={1.4} />
          <h1 className="font-serif text-3xl text-white mb-2">Đặt lịch tuần của bạn</h1>
          <p className="text-sm text-slate-400 max-w-md mx-auto leading-relaxed">
            Chọn ngày và giờ bạn thật sự học được. Tối đa {MAX_PER_DAY} buổi mỗi ngày —
            giới hạn này là cố ý. Trong mỗi buổi, hệ thống chạy 45 phút học rồi 5–10 phút nghỉ.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {DAYS.map((label, day) => {
            const sessions = perDay(day).sort((a, b) => a.startMinute - b.startMinute);
            const full = sessions.length >= MAX_PER_DAY;
            return (
              <div key={day} className="glass rounded-2xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-white">{label}</p>
                  <span className="text-[10px] uppercase tracking-[2px] text-white/35">
                    {sessions.length}/{MAX_PER_DAY} buổi
                  </span>
                </div>

                <div className="flex flex-wrap gap-2">
                  {sessions.map(b => (
                    <span key={b.id} className="glass-pill rounded-xl pl-3 pr-2 py-1.5 flex items-center gap-2 text-xs">
                      <span>{SUBJECT_META[b.subjectKey]?.icon}</span>
                      <span className="text-white/85">
                        {minutesToHHMM(b.startMinute)}–{minutesToHHMM(b.startMinute + b.durationMinutes)}
                      </span>
                      <button onClick={() => remove(b.id)} aria-label="Xoá buổi"
                        className="text-white/30 hover:text-red-300 transition-colors">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  ))}

                  {!full && addingDay !== day && (
                    <button onClick={() => openAdd(day)}
                      className="glass-pill rounded-xl px-3 py-1.5 text-xs text-white/60 hover:text-white flex items-center gap-1.5 transition-colors">
                      <Plus className="w-3.5 h-3.5" /> Thêm buổi
                    </button>
                  )}
                  {full && sessions.length > 0 && (
                    <span className="text-[11px] text-white/30 self-center">Đã đủ {MAX_PER_DAY} buổi</span>
                  )}
                </div>

                {addingDay === day && (
                  <div className="mt-3 pt-3 border-t border-white/10 flex flex-col gap-3">
                    <div className="flex flex-wrap gap-2">
                      {SUBJECTS.map(s => (
                        <button key={s} onClick={() => setSubject(s)}
                          className={`px-3 py-1.5 rounded-xl text-xs transition-colors ${subject === s ? 'glass-pill-active' : 'glass-pill'}`}>
                          {SUBJECT_META[s].icon} {SUBJECT_META[s].label}
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="text-xs text-slate-400">Từ</label>
                      <input type="time" value={from} onChange={e => setFrom(e.target.value)}
                        className="bg-white/5 rounded-xl px-3 py-2 text-sm text-slate-200 outline-none border border-white/10 focus:border-white/25" />
                      <label className="text-xs text-slate-400">đến</label>
                      <input type="time" value={to} onChange={e => setTo(e.target.value)}
                        className="bg-white/5 rounded-xl px-3 py-2 text-sm text-slate-200 outline-none border border-white/10 focus:border-white/25" />
                    </div>
                    {error && <p className="text-xs text-red-300/80">{error}</p>}
                    <div className="flex gap-2">
                      <button onClick={() => { setAddingDay(null); setError(''); }}
                        className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
                        Huỷ
                      </button>
                      <button onClick={confirmAdd}
                        className="ml-auto rounded-xl px-4 py-2 text-[11px] uppercase tracking-[2px] bg-purple-400/15 text-purple-200 hover:bg-purple-400/25 transition-colors">
                        Thêm
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex flex-col items-center gap-3 mt-8">
          <LiquidMetalButton
            label={busy ? 'Đang lưu…' : blocks.length === 0 ? 'Bỏ qua, vào workspace' : 'Xong · vào workspace'}
            onClick={finish}
          />
          <p className="text-[11px] text-slate-500">
            {blocks.length === 0
              ? 'Bạn có thể đặt lịch sau trong phần cài đặt.'
              : `${blocks.length} buổi trong tuần. Sửa lại bất cứ lúc nào.`}
          </p>
        </div>
      </div>
    </div>
  );
}
