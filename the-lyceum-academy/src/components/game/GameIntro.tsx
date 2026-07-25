import { useState } from 'react';
import { FlaskConical, Dna, Sigma, Zap } from 'lucide-react';
import type { Subject } from '../../lib/gameApi';

const SUBJECTS: { id: Subject; label: string; icon: typeof Dna }[] = [
  { id: 'sinh', label: 'Sinh học', icon: Dna },
  { id: 'toan', label: 'Toán học', icon: Sigma },
  { id: 'hoa', label: 'Hoá học', icon: FlaskConical },
  { id: 'ly', label: 'Vật lý', icon: Zap },
];

const CURRICULA = ['AP', 'IB', 'A-Level', 'IGCSE'];

export default function GameIntro({
  onStart, busy, error,
}: {
  onStart: (subject: Subject, curriculum: string, playerName: string) => void;
  busy: boolean;
  error: string;
}) {
  const [name, setName] = useState('');
  const [subject, setSubject] = useState<Subject | null>(null);
  const [curriculum, setCurriculum] = useState('');
  const [customCurriculum, setCustomCurriculum] = useState('');

  const finalCurriculum = curriculum === 'Other' ? customCurriculum.trim() : curriculum;
  const canStart = !!name.trim() && !!subject && !!finalCurriculum && !busy;

  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-lg liquid-glass rounded-3xl p-8">
        <p className="text-white/40 text-xs tracking-widest uppercase mb-2">The Lyceum · thử thách</p>
        <h1 className="font-instrument text-4xl md:text-5xl text-white tracking-tight mb-3">
          Nghĩ mình giỏi? <em className="italic">Chứng minh đi.</em>
        </h1>
        <p className="text-white/60 text-sm leading-relaxed mb-8">
          20 câu. Soi lỗi sai, giải thích khái niệm, đọc hình. Trả lời sai không sao —
          nhưng nói &quot;không biết&quot; thì đừng trách bị mỉa. Nhập tên để lên bảng xếp hạng.
        </p>

        <label className="block text-white/50 text-xs uppercase tracking-wider mb-2">Tên của bạn</label>
        <input
          value={name} onChange={(e) => setName(e.target.value)} maxLength={40}
          placeholder="Để cả bảng xếp hạng biết tên bạn…"
          className="w-full bg-white/5 rounded-xl px-4 py-3 text-white placeholder:text-white/30 outline-none border border-white/10 focus:border-white/30 mb-6"
        />

        <label className="block text-white/50 text-xs uppercase tracking-wider mb-2">Chọn môn</label>
        <div className="grid grid-cols-2 gap-3 mb-6">
          {SUBJECTS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSubject(s.id)}
              className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium border transition-colors ${
                subject === s.id
                  ? 'bg-white text-black border-white'
                  : 'bg-white/5 text-white/80 border-white/10 hover:border-white/30'
              }`}
            >
              <s.icon className="w-4 h-4" /> {s.label}
            </button>
          ))}
        </div>

        <label className="block text-white/50 text-xs uppercase tracking-wider mb-2">Đang học chương trình nào?</label>
        <div className="flex flex-wrap gap-2 mb-3">
          {CURRICULA.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCurriculum(c)}
              className={`rounded-full px-4 py-1.5 text-xs font-medium border transition-colors ${
                curriculum === c
                  ? 'bg-white text-black border-white'
                  : 'bg-white/5 text-white/70 border-white/10 hover:border-white/30'
              }`}
            >
              {c}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setCurriculum('Other')}
            className={`rounded-full px-4 py-1.5 text-xs font-medium border transition-colors ${
              curriculum === 'Other'
                ? 'bg-white text-black border-white'
                : 'bg-white/5 text-white/70 border-white/10 hover:border-white/30'
            }`}
          >
            Khác
          </button>
        </div>
        {curriculum === 'Other' && (
          <input
            value={customCurriculum} onChange={(e) => setCustomCurriculum(e.target.value)} maxLength={60}
            placeholder="Ví dụ: chương trình phổ thông Việt Nam…"
            className="w-full bg-white/5 rounded-xl px-4 py-3 text-white placeholder:text-white/30 outline-none border border-white/10 focus:border-white/30 mb-6"
          />
        )}

        {error && <p className="text-red-300 text-sm mb-4">{error}</p>}

        <button
          type="button"
          disabled={!canStart}
          onClick={() => subject && onStart(subject, finalCurriculum, name.trim())}
          className="w-full mt-2 bg-white text-black rounded-full py-3.5 text-sm font-semibold disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white/90 transition-colors"
        >
          {busy ? 'Đang dựng đề…' : 'Vào thử thách'}
        </button>
      </div>
    </div>
  );
}
